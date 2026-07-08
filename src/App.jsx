import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const API_BASE = 'http://localhost:3001';

function ChatPanel({ title, type, pdfUploaded, apiKey, model, color }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  const sendQuestion = async () => {
    if (!input.trim() || !pdfUploaded) return;
    const question = input.trim();
    setInput('');
    setLoading(true);

    setMessages(prev => [...prev, { role: 'user', content: question }]);

    try {
      const res = await fetch(`${API_BASE}/api/chat/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, apiKey, model }),
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
        });
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    }
    setLoading(false);
  };

  return (
    <div className={`chat-panel ${color}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        <span className="badge">{type === 'norag' ? 'No RAG — Full PDF' : 'RAG — Smart Retrieval'}</span>
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
          placeholder={pdfUploaded ? 'Ask a question about the PDF...' : 'Upload a PDF first'}
          disabled={!pdfUploaded || loading}
        />
        <button onClick={sendQuestion} disabled={!pdfUploaded || loading}>
          Send
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('meta-llama/llama-3.1-8b-instruct:free');
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfInfo, setPdfInfo] = useState(null);
  const [uploading, setUploading] = useState(false);

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
        <h1>RAG vs No-RAG Demo</h1>
        <p className="subtitle">See why Retrieval-Augmented Generation saves tokens, money, and gives better answers</p>
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
          <label>Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}>
            <option value="meta-llama/llama-3.1-8b-instruct:free">Llama 3.1 8B (Free)</option>
            <option value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash (Free)</option>
            <option value="mistralai/mistral-7b-instruct:free">Mistral 7B (Free)</option>
            <option value="deepseek/deepseek-v4-flash">DeepSeek V4 Flash</option>
            <option value="meta-llama/llama-3.1-70b-instruct">Llama 3.1 70B</option>
            <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
          </select>
        </div>
        <div className="config-group">
          <label>Upload PDF</label>
          <div className="upload-row">
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0])} />
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
      </div>

      <div className="panels">
        <ChatPanel
          title="No RAG"
          type="norag"
          pdfUploaded={!!pdfInfo}
          apiKey={apiKey}
          model={model}
          color="red"
        />
        <ChatPanel
          title="RAG"
          type="rag"
          pdfUploaded={!!pdfInfo}
          apiKey={apiKey}
          model={model}
          color="green"
        />
      </div>
    </div>
  );
}
