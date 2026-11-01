// src/pages/HistoryPage.tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Archive, Trash2, Download, Search } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useHistoryStore } from '../stores/useHistoryStore';

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}
function formatBytes(b: number): string {
  return b < 1024 ? `${b}B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1024 / 1024).toFixed(2)}MB`;
}

export default function HistoryPage() {
  const { records, deleteRecord, clearAll, loadFromStorage } = useHistoryStore();
  const [search, setSearch] = useState('');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const filtered = records.filter(r =>
    r.prompt.toLowerCase().includes(search.toLowerCase()) ||
    r.sessionId.toLowerCase().includes(search.toLowerCase())
  );

  const handleExport = () => {
    const json = JSON.stringify(filtered, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splitinfer-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div className="max-w-4xl mx-auto py-8 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Session History</h1>
          <p className="text-text-secondary text-sm mt-1">{records.length} records stored locally</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 bg-surface-secondary hover:bg-surface-tertiary text-sm py-2"
          >
            <Download size={14} /> Export JSON
          </Button>
          <Button
            onClick={() => { if (confirm('Clear all history?')) clearAll(); }}
            disabled={records.length === 0}
            className="flex items-center gap-2 bg-danger/20 text-danger hover:bg-danger/30 text-sm py-2"
          >
            <Trash2 size={14} /> Clear All
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search by prompt or session ID…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="p-12 bg-surface rounded-lg text-center">
          <Archive size={40} className="mx-auto mb-4 text-text-muted" />
          <p className="text-text-secondary">
            {records.length === 0
              ? 'No history yet. Run an inference to see results here.'
              : 'No records match your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <motion.div
              key={r.id}
              className="p-4 bg-surface rounded-lg"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-text-secondary text-xs font-mono">{r.sessionId} · {new Date(r.createdAt).toLocaleString()}</p>
                  <p className="font-medium mt-1">{r.prompt.slice(0, 80)}{r.prompt.length > 80 ? '…' : ''}</p>
                </div>
                <button
                  onClick={() => deleteRecord(r.id)}
                  className="text-text-muted hover:text-danger transition p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="bg-surface-secondary rounded p-2 font-mono text-xs text-text-secondary max-h-24 overflow-auto">
                {r.output || '(no output)'}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-text-muted">
                <span>{r.deviceCount} devices</span>
                <span>{r.tokenCount} tokens</span>
                <span>{formatMs(r.totalMs)}</span>
                <span>{formatBytes(r.bytesTransferred)} transferred</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
