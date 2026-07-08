import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
// Uses built-in fetch (Node 18+)

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

// In-memory store for the uploaded PDF text
let pdfStore = { text: '', filename: '' };

// ── PDF Upload ──────────────────────────────────────────────
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    const parser = new PDFParse({ data: req.file.buffer });
    const textResult = await parser.getText();
    const fullText = textResult.text;
    await parser.destroy();
    pdfStore = { text: fullText, filename: req.file.originalname };
    res.json({ filename: pdfStore.filename, charCount: pdfStore.text.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse PDF: ' + err.message });
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

// ── No-RAG Chat: Stuff entire PDF into prompt ──────────────
app.post('/api/chat/norag', async (req, res) => {
  try {
    const { question, apiKey, model } = req.body;
    if (!pdfStore.text) return res.status(400).json({ error: 'No PDF uploaded' });

    const messages = [
      {
        role: 'system',
        content: `You are a helpful assistant. Below is the FULL content of a PDF document. Use ONLY this content to answer the user's question. If the answer is not in the document, say "I cannot find the answer in the document."\n\n--- FULL PDF CONTENT (entire document) ---\n${pdfStore.text}\n--- END OF PDF CONTENT ---`
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
    const { question, apiKey, model } = req.body;
    if (!pdfStore.text) return res.status(400).json({ error: 'No PDF uploaded' });

    // 1. Chunk the PDF text
    const chunks = chunkText(pdfStore.text, 500, 100);

    // 2. Get embeddings for all chunks + the question
    const allTexts = [...chunks, question];
    const { embeddings, tokens: embedTokens } = await getEmbeddings(allTexts, apiKey);

    const questionEmbedding = embeddings[embeddings.length - 1];
    const chunkEmbeddings = embeddings.slice(0, -1);

    // 3. Compute similarity and pick top 3
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

    const messages = [
      {
        role: 'system',
        content: `You are a helpful assistant. Use ONLY the following relevant excerpts from a PDF document to answer the user's question. If the answer is not in the excerpts, say "I cannot find the answer in the provided context."\n\n--- RELEVANT EXCERPTS (RAG retrieved) ---\n${context}\n--- END OF EXCERPTS ---`
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

app.listen(3001, () => console.log('✅ RAG Demo server running on http://localhost:3001'));
