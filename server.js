import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import path from 'path';
// Uses built-in fetch (Node 18+)

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

// In-memory store for the uploaded PDF text
let pdfStore = { text: '', filename: '' };

// ── Document Upload (PDF or DOCX) ───────────────────────────
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fullText = '';

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      fullText = result.value;
    } else {
      const parser = new PDFParse({ data: req.file.buffer });
      const textResult = await parser.getText();
      fullText = textResult.text;
      await parser.destroy();
    }

    pdfStore = { text: fullText, filename: req.file.originalname };
    res.json({ filename: pdfStore.filename, charCount: pdfStore.text.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse document: ' + err.message });
  }
});

// ── Helper: Call OpenRouter chat ────────────────────────────
async function callOpenRouter(messages, apiKey, model) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
    },
    body: JSON.stringify({ model, messages }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const usage = data.usage || {};
  return {
    content: data.choices?.[0]?.message?.content || 'No response',
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
}

// ── Helper: Call OpenRouter embeddings ──────────────────────
async function getEmbeddings(texts, apiKey) {
  const resp = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-embedding-2',
      input: texts,
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const usage = data.usage || {};
  return {
    embeddings: data.data.map(d => d.embedding),
    tokens: usage.total_tokens || 0,
  };
}

// ── Helper: Call Tavily web search ──────────────────────────
async function callTavily(query, tavilyKey, maxResults = 5) {
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tavilyKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      search_depth: 'advanced',
      max_results: maxResults,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || data.detail || `Tavily request failed (${resp.status})`);
  }
  return {
    results: (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content || '',
      score: r.score || 0,
    })),
  };
}

// ── Helper: Cosine similarity ───────────────────────────────
function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Helper: Chunk text ──────────────────────────────────────
function chunkText(text, chunkSize = 500, overlap = 100) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 0) chunks.push(chunk);
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}

// ── Helper: Validate API key ───────────────────────────────
function validateApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Please enter your OpenRouter API key in the config bar above.');
  }
}

// ── Helper: Validate Tavily key ────────────────────────────
function validateTavilyKey(tavilyKey) {
  if (!tavilyKey || !tavilyKey.trim()) {
    throw new Error('Please enter your Tavily API key in the config bar above.');
  }
}

// ── Plain QA Chat: No PDF, just question answering ──────────
app.post('/api/chat/plain', async (req, res) => {
  try {
    const { question, apiKey, model, systemPrompt } = req.body;
    validateApiKey(apiKey);

    const defaultSystem = systemPrompt?.trim()
      ? systemPrompt.trim()
      : 'You are a helpful assistant. Answer the user\'s question clearly and concisely.';

    const messages = [
      { role: 'system', content: defaultSystem },
      { role: 'user', content: question },
    ];

    const result = await callOpenRouter(messages, apiKey, model);
    res.json({
      answer: result.content,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      contextSent: 'None (plain QA)',
      chunksUsed: 0,
      totalChunks: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── No-RAG Chat: Stuff entire PDF into prompt ──────────────
app.post('/api/chat/norag', async (req, res) => {
  try {
    const { question, apiKey, model, systemPrompt } = req.body;
    validateApiKey(apiKey);
    if (!pdfStore.text) return res.status(400).json({ error: 'No PDF uploaded' });

    const baseSystem = systemPrompt?.trim()
      ? systemPrompt.trim()
      : `You are a helpful assistant. Below is the FULL content of a PDF document. Use ONLY this content to answer the user's question. If the answer is not in the document, say "I cannot find the answer in the document."`;

    const messages = [
      {
        role: 'system',
        content: `${baseSystem}\n\n--- FULL PDF CONTENT (entire document) ---\n${pdfStore.text}\n--- END OF PDF CONTENT ---`
      },
      { role: 'user', content: question },
    ];

    const result = await callOpenRouter(messages, apiKey, model);
    res.json({
      answer: result.content,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      contextSent: `Full PDF (${pdfStore.text.length} characters)`,
      chunksUsed: 0,
      totalChunks: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RAG Chat: Chunk → Embed → Retrieve → Prompt ──────────
app.post('/api/chat/rag', async (req, res) => {
  try {
    const { question, apiKey, model, systemPrompt } = req.body;
    validateApiKey(apiKey);
    if (!pdfStore.text) return res.status(400).json({ error: 'No PDF uploaded' });

    // 1. Chunk the PDF text
    const chunks = chunkText(pdfStore.text, 500, 100);

    // 2. Get embeddings for all chunks + the question
    const allTexts = [...chunks, question];
    const { embeddings, tokens: embedTokens } = await getEmbeddings(allTexts, apiKey);

    const questionEmbedding = embeddings[embeddings.length - 1];
    const chunkEmbeddings = embeddings.slice(0, -1);

    // 3. Compute similarity and pick top 5
    const scored = chunkEmbeddings.map((emb, i) => ({
      index: i,
      score: cosineSim(questionEmbedding, emb),
    }));
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, 5);
    const relevantChunks = topK.map(s => ({
      text: chunks[s.index],
      score: s.score,
    }));

    // 4. Build context from relevant chunks only
    const context = relevantChunks
      .map((c, i) => `[Chunk ${i + 1} (relevance: ${(c.score * 100).toFixed(1)}%)]\n${c.text}`)
      .join('\n\n');

    const baseSystem = systemPrompt?.trim()
      ? systemPrompt.trim()
      : `You are a helpful assistant. Use ONLY the following relevant excerpts from a PDF document to answer the user's question. If the answer is not in the excerpts, say "I cannot find the answer in the provided context."`;

    const messages = [
      {
        role: 'system',
        content: `${baseSystem}\n\n--- RELEVANT EXCERPTS (RAG retrieved) ---\n${context}\n--- END OF EXCERPTS ---`
      },
      { role: 'user', content: question },
    ];

    const result = await callOpenRouter(messages, apiKey, model);
    res.json({
      answer: result.content,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      embedTokens,
      contextSent: `${relevantChunks.length} chunks out of ${chunks.length} total`,
      chunksUsed: relevantChunks.length,
      totalChunks: chunks.length,
      retrievedChunks: relevantChunks.map(c => ({
        preview: c.text.substring(0, 150) + '...',
        score: c.score,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Web Search Chat: Tavily retrieve → Prompt (Web-RAG) ────
app.post('/api/chat/search', async (req, res) => {
  try {
    const { question, apiKey, model, systemPrompt, tavilyKey } = req.body;
    validateApiKey(apiKey);
    validateTavilyKey(tavilyKey);

    // 1. Retrieve live web results from Tavily
    const { results } = await callTavily(question, tavilyKey, 5);
    if (results.length === 0) {
      return res.json({
        answer: 'No web results were found for this query.',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        contextSent: '0 web results',
        chunksUsed: 0,
        totalChunks: 0,
        sources: [],
      });
    }

    // 2. Build context from the retrieved web results
    const context = results
      .map((r, i) => `[Source ${i + 1}: ${r.title} (${r.url})]\n${r.content}`)
      .join('\n\n');

    const baseSystem = systemPrompt?.trim()
      ? systemPrompt.trim()
      : `You are a helpful assistant with access to live web search results. Use ONLY the following web excerpts to answer the user's question, and cite the source number(s) you rely on. If the answer is not in the excerpts, say "I cannot find the answer in the web results."`;

    const messages = [
      {
        role: 'system',
        content: `${baseSystem}\n\n--- WEB SEARCH RESULTS (Tavily retrieved) ---\n${context}\n--- END OF RESULTS ---`
      },
      { role: 'user', content: question },
    ];

    const result = await callOpenRouter(messages, apiKey, model);
    res.json({
      answer: result.content,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      contextSent: `${results.length} web results`,
      chunksUsed: results.length,
      totalChunks: results.length,
      sources: results.map(r => ({
        title: r.title,
        url: r.url,
        score: r.score,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log('✅ RAG Demo server running on http://localhost:3001'));
