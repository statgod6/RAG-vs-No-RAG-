import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const API_BASE = 'http://localhost:3001';

function ChatPanel({ title, type, pdfUploaded, apiKey, model, color, systemPrompt, tavilyKey }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  // Only the PDF-based modes require an uploaded document
  const needsPdf = type === 'norag' || type === 'rag';

  const sendQuestion = async () => {
    if (!input.trim()) return;
    if (needsPdf && !pdfUploaded) return;
    const question = input.trim();
    setInput('');
    setLoading(true);

    setMessages(prev => [...prev, { role: 'user', content: question }]);

    try {
      const res = await fetch(`${API_BASE}/api/chat/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, apiKey, model, systemPrompt, tavilyKey }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
        setStats({
          promptTokens: data.promptTokens,
          completionTokens: data.completionTokens,
          totalTokens: data.totalTokens,
          embedTokens: data.embedTokens || 0,
          contextSent: data.contextSent,
          chunksUsed: data.chunksUsed,
          totalChunks: data.totalChunks,
          retrievedChunks: data.retrievedChunks || [],
          sources: data.sources || [],
        });
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    }
    setLoading(false);
  };

  const badgeLabel = type === 'plain'
    ? 'Plain QA — No Context'
    : type === 'norag'
      ? 'No RAG — Full Document'
      : type === 'search'
        ? 'Web Search — Tavily'
        : 'RAG — Smart Retrieval';

  const placeholder = needsPdf
    ? (pdfUploaded ? 'Ask a question about the document...' : 'Upload a PDF or DOCX first')
    : type === 'search'
      ? 'Search the web...'
      : 'Ask any question...';

  const disabled = (needsPdf && !pdfUploaded) || loading;

  return (
    <div className={`chat-panel ${color}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        <span className="badge">{badgeLabel}</span>
      </div>

      {stats && (
        <div className="stats-bar">
          <div className="stat">
            <span className="stat-label">Prompt Tokens</span>
            <span className={`stat-value ${type === 'norag' ? 'high' : 'low'}`}>{stats.promptTokens}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Tokens</span>
            <span className={`stat-value ${type === 'norag' ? 'high' : 'low'}`}>{stats.totalTokens}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Context Sent</span>
            <span className="stat-value small">{stats.contextSent}</span>
          </div>
          {type === 'rag' && stats.embedTokens > 0 && (
            <div className="stat">
              <span className="stat-label">Embed Tokens</span>
              <span className="stat-value low">{stats.embedTokens}</span>
            </div>
          )}
        </div>
      )}

      {stats?.retrievedChunks?.length > 0 && (
        <details className="chunks-detail">
          <summary>Retrieved Chunks ({stats.chunksUsed}/{stats.totalChunks})</summary>
          {stats.retrievedChunks.map((c, i) => (
            <div key={i} className="chunk-item">
              <span className="chunk-score">{(c.score * 100).toFixed(1)}%</span>
              <span className="chunk-preview">{c.preview}</span>
            </div>
          ))}
        </details>
      )}

      {stats?.sources?.length > 0 && (
        <details className="chunks-detail">
          <summary>Web Sources ({stats.sources.length})</summary>
          {stats.sources.map((s, i) => (
            <div key={i} className="chunk-item">
              <span className="chunk-score">{(s.score * 100).toFixed(1)}%</span>
              <a className="source-link" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title || s.url}
              </a>
            </div>
          ))}
        </details>
      )}

      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-role">{msg.role === 'user' ? 'You' : 'Assistant'}</div>
            <div className="message-content">
              {msg.role === 'assistant' ? (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <div className="message-role">Assistant</div>
            <div className="message-content typing">Thinking...</div>
          </div>
        )}
      </div>

      <div className="input-row">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendQuestion()}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button onClick={sendQuestion} disabled={disabled}>
          Send
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [tavilyKey, setTavilyKey] = useState('');
  const [model, setModel] = useState('deepseek/deepseek-v4-flash');
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfInfo, setPdfInfo] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);

  const uploadPdf = async () => {
    if (!pdfFile) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('pdf', pdfFile);
    try {
      const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) {
        alert('Upload failed: ' + data.error);
      } else {
        setPdfInfo(data);
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
    setUploading(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Plain QA vs No-RAG vs RAG vs Web Search</h1>
        <p className="subtitle">Compare how context strategy affects answer quality, token usage, and cost</p>
      </header>

      <div className="config-bar">
        <div className="config-group">
          <label>OpenRouter API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-or-v1-..."
          />
        </div>
        <div className="config-group">
          <label>Tavily API Key</label>
          <input
            type="password"
            value={tavilyKey}
            onChange={e => setTavilyKey(e.target.value)}
            placeholder="tvly-..."
          />
        </div>
        <div className="config-group">
          <label>Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}>
            <option value="deepseek/deepseek-v4-flash">DeepSeek V4 Flash</option>
            <option value="inclusionai/ling-3.0-flash:free">Ling 3.0 Flash (Free)</option>
          </select>
        </div>
        <div className="config-group">
          <label>Upload Document</label>
          <div className="upload-row">
            <input type="file" accept=".pdf,.docx" onChange={e => setPdfFile(e.target.files[0])} />
            <button onClick={uploadPdf} disabled={!pdfFile || uploading}>
              {uploading ? 'Parsing...' : 'Upload & Parse'}
            </button>
          </div>
          {pdfInfo && (
            <span className="pdf-info">
              {pdfInfo.filename} — {pdfInfo.charCount.toLocaleString()} chars
            </span>
          )}
        </div>
        <div className="config-group config-group-wide">
          <label
            className="prompt-toggle"
            onClick={() => setPromptExpanded(p => !p)}
          >
            Custom System Prompt {promptExpanded ? '▾' : '▸'} <span className="prompt-hint">(applies to all chats)</span>
          </label>
          {promptExpanded && (
            <textarea
              className="system-prompt-input"
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="Leave empty for default prompts, or write your own system prompt for all three chat modes..."
              rows={3}
            />
          )}
        </div>
      </div>

      <div className="panels-top">
        <ChatPanel
          title="Plain QA"
          type="plain"
          pdfUploaded={true}
          apiKey={apiKey}
          model={model}
          color="blue"
          systemPrompt={systemPrompt}
        />
        <ChatPanel
          title="Web Search"
          type="search"
          pdfUploaded={true}
          apiKey={apiKey}
          model={model}
          color="purple"
          systemPrompt={systemPrompt}
          tavilyKey={tavilyKey}
        />
      </div>
      <div className="panels-bottom">
        <ChatPanel
          title="No RAG"
          type="norag"
          pdfUploaded={!!pdfInfo}
          apiKey={apiKey}
          model={model}
          color="red"
          systemPrompt={systemPrompt}
        />
        <ChatPanel
          title="RAG"
          type="rag"
          pdfUploaded={!!pdfInfo}
          apiKey={apiKey}
          model={model}
          color="green"
          systemPrompt={systemPrompt}
        />
      </div>
    </div>
  );
}
