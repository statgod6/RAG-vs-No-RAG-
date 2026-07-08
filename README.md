# RAG vs No-RAG Demo

An educational demonstration tool that visually compares **Retrieval-Augmented Generation (RAG)** against a **No-RAG approach** where the entire PDF is stuffed into the LLM prompt. Perfect for teaching students why RAG is more cost-effective, faster, and more accurate.

## What It Does

Two side-by-side chat panels share the same uploaded PDF and model. Ask the same question on both sides and watch the difference:

| | No RAG (Red) | RAG (Green) |
|---|---|---|
| **Context sent** | Entire PDF | Only 5 relevant chunks |
| **Prompt tokens** | Thousands (expensive) | Hundreds (cheap) |
| **Approach** | Brute-force all text | Smart retrieval via embeddings |
| **Quality** | May hallucinate from noise | Focused, grounded answers |

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Express.js (Node.js)
- **PDF Parsing:** pdf-parse v2
- **Embeddings:** Google Gemini Embedding via OpenRouter
- **LLM:** Any model available on [OpenRouter](https://openrouter.ai)
- **Vector Search:** In-memory cosine similarity (no database needed)

## Setup

### Prerequisites

- **Node.js** 18+ (built-in `fetch` required)
- An **OpenRouter API key** ([get one free](https://openrouter.ai/keys))

### Install & Run

```bash
git clone https://github.com/statgod6/RAG-vs-No-RAG-.git
cd RAG-vs-No-RAG-
npm install
```

Start the backend server:

```bash
node server.js
```

Start the frontend (in a separate terminal):

```bash
npx vite --port 5173
```

Open **http://localhost:5173** in your browser.

## How to Use

1. Paste your **OpenRouter API key**
2. Select a **model** (free models like Llama 3.1 8B work great)
3. **Upload a PDF** document
4. Ask the **same question** on both panels
5. Compare the **token counts** and **answer quality**

## Available Models

- Llama 3.1 8B (Free)
- Gemini 2.0 Flash (Free)
- Mistral 7B (Free)
- DeepSeek V4 Flash
- Llama 3.1 70B
- Claude 3.5 Sonnet

## Architecture

```
Browser (React/Vite)
    │
    ├── Upload PDF ──→ Express Server ──→ pdf-parse (extract text)
    │
    ├── No-RAG Chat ──→ Express Server ──→ Full PDF in prompt ──→ OpenRouter LLM
    │
    └── RAG Chat ──→ Express Server ──→ Chunk → Embed → Retrieve ──→ OpenRouter LLM
                                           │
                                           ├── Chunk text (500 words, 100 overlap)
                                           ├── Get embeddings (Gemini Embedding)
                                           ├── Cosine similarity ranking
                                           └── Send top 5 chunks as context
```

## Key Teaching Points

- **Token economics:** No-RAG sends the entire document — massive token usage and cost
- **Context window limits:** Large PDFs can exceed the model's context window entirely
- **Retrieval precision:** RAG sends only the most relevant portions — fewer tokens, focused answers
- **Embedding cost:** Embedding tokens are negligible compared to full-document prompt tokens

## License

MIT
