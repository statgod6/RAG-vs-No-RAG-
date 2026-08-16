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

// ── Helper: Chunk text into exactly N chunks ─────────────────
function chunkText(text, numChunks = 5) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= numChunks) return words.map(w => w);
  const size = Math.ceil(words.length / numChunks);
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const start = i * size;
    const chunk = words.slice(start, Math.min(start + size, words.length)).join(' ');
    if (chunk.trim()) chunks.push(chunk);
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

// ── Combined RAG + Search Chat ───────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { question, apiKey, model, systemPrompt, tavilyKey } = req.body;
    validateApiKey(apiKey);
    if (!pdfStore.text) return res.status(400).json({ error: 'No document uploaded. Please upload a PDF or DOCX first.' });

    // 1. Chunk the document into exactly 5 chunks
    const chunks = chunkText(pdfStore.text, 5);

    // 2. Embed all chunks + question
    const allTexts = [...chunks, question];
    const { embeddings, tokens: embedTokens } = await getEmbeddings(allTexts, apiKey);

    const questionEmbedding = embeddings[embeddings.length - 1];
    const chunkEmbeddings = embeddings.slice(0, -1);

    // 3. Score and retrieve all 5 chunks
    const scored = chunkEmbeddings.map((emb, i) => ({
      index: i,
      score: cosineSim(questionEmbedding, emb),
    }));
    scored.sort((a, b) => b.score - a.score);
    const relevantChunks = scored.map(s => ({
      text: chunks[s.index],
      score: s.score,
    }));

    // 4. Tavily web search (if key provided)
    let webResults = [];
    if (tavilyKey && tavilyKey.trim()) {
      const { results } = await callTavily(question, tavilyKey, 5);
      webResults = results;
    }

    // 5. Build combined context
    const ragContext = relevantChunks
      .map((c, i) => `[PDF Chunk ${i + 1} (relevance: ${(c.score * 100).toFixed(1)}%)]\n${c.text}`)
      .join('\n\n');

    let contextParts = [`=== DOCUMENT CONTEXT (5 chunks from uploaded document) ===\n${ragContext}`];

    if (webResults.length > 0) {
      const webContext = webResults
        .map((r, i) => `[Web Source ${i + 1}: ${r.title} (${r.url})]\n${r.content}`)
        .join('\n\n');
      contextParts.push(`=== WEB SEARCH RESULTS (Tavily) ===\n${webContext}`);
    }

    const combinedContext = contextParts.join('\n\n');

    const baseSystem = systemPrompt?.trim()
      ? systemPrompt.trim()
      : `You are a helpful assistant with access to a document and live web search results. Prioritize the document excerpts for your answer, and supplement with web results when the document doesn't fully cover the question. Cite your sources (PDF chunk numbers or web URLs). If neither source has the answer, say "I cannot find the answer in the available sources."`;

    const messages = [
      {
        role: 'system',
        content: `${baseSystem}\n\n--- COMBINED CONTEXT ---\n${combinedContext}\n--- END OF CONTEXT ---`
      },
      { role: 'user', content: question },
    ];

    const result = await callOpenRouter(messages, apiKey, model);
    const contextLabel = webResults.length > 0
      ? `5 PDF chunks + ${webResults.length} web results`
      : '5 PDF chunks';

    res.json({
      answer: result.content,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      embedTokens,
      contextSent: contextLabel,
      chunksUsed: relevantChunks.length,
      totalChunks: chunks.length,
      retrievedChunks: relevantChunks.map(c => ({
        preview: c.text.substring(0, 150) + '...',
        score: c.score,
      })),
      sources: webResults.map(r => ({
        title: r.title,
        url: r.url,
        score: r.score,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log('✅ RAG Search Assistant running on http://localhost:3001'));
