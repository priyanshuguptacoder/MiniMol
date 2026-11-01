// src/pages/DashboardPage.tsx
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Cpu, Clock, BarChart2, PlusCircle, Send } from 'lucide-react';
import { motion } from 'framer-motion';
import KPICard from '../components/KPICard';
import { useSessionStore } from '../stores/useSessionStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { useInferenceStore } from '../stores/useInferenceStore';
import { useHistoryStore } from '../stores/useHistoryStore';
import { signalingClient } from '../services/SignalingClient';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function DashboardPage() {
  const { devices, sessionId, status } = useSessionStore();
  const { totalBytesSent, totalBytesReceived, peers } = useNetworkStore();
  const { currentRun, status: inferStatus } = useInferenceStore();
  const { records, loadFromStorage } = useHistoryStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const connectedPeers = Object.values(peers).filter(p => p.status === 'connected').length;
  const avgRtt = Object.values(peers)
    .map(p => p.rttMs)
    .filter((r): r is number => r !== null);
  const avgRttDisplay = avgRtt.length > 0
    ? `${Math.round(avgRtt.reduce((a, b) => a + b, 0) / avgRtt.length)} ms`
    : 'N/A';
  const totalData = formatBytes(totalBytesSent + totalBytesReceived);

  const hasSession = !!sessionId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        {hasSession && (
          <span className={`px-3 py-1 text-xs rounded-full font-mono ${
            status === 'active' ? 'bg-success/20 text-success' :
            status === 'waiting' ? 'bg-warning/20 text-warning' :
            'bg-surface-secondary text-text-muted'
          }`}>
            {status.toUpperCase()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Connected Devices" value={devices.length || connectedPeers + (hasSession ? 1 : 0)} icon={<Users size={20} />} />
        <KPICard title="Active Session" value={sessionId ?? 'None'} icon={<Cpu size={20} />} />
        <KPICard title="Avg RTT" value={avgRttDisplay} icon={<Clock size={20} />} />
        <KPICard title="Data Transferred" value={totalData} icon={<BarChart2 size={20} />} />
      </div>

      {!hasSession ? (
        <motion.div
          className="p-8 bg-surface rounded-lg text-center space-y-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <p className="text-text-secondary mb-4">
            No active session. Create a session to start distributed inference, or join an existing one.
          </p>
          <div className="flex justify-center gap-4">
            <Link
              to="/sessions/create"
              className="flex items-center gap-2 px-5 py-2 bg-accent text-background rounded hover:bg-accent-hover transition"
            >
              <PlusCircle size={18} /> Create Session
            </Link>
            <Link
              to="/sessions/join"
              className="flex items-center gap-2 px-5 py-2 border border-border rounded hover:border-accent transition"
            >
              <Send size={18} /> Join Session
            </Link>
          </div>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Device list */}
          <div className="p-5 bg-surface rounded-lg">
            <h2 className="text-lg font-semibold mb-3">Devices in Session</h2>
            {devices.length === 0 ? (
              <p className="text-text-secondary text-sm">No devices registered yet.</p>
            ) : (
              <ul className="space-y-2">
                {devices.map(d => (
                  <li key={d.deviceId} className="flex items-center justify-between bg-surface-secondary px-3 py-2 rounded text-sm">
                    <span className="font-mono text-xs">{d.deviceId.slice(0, 10)}…</span>
                    <span className="text-accent">Stage {d.stageIndex}</span>
                    <span className="text-text-muted">{d.capabilities ? `${d.capabilities.cpuCores} cores` : 'N/A'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Current inference */}
          <div className="p-5 bg-surface rounded-lg">
            <h2 className="text-lg font-semibold mb-3">Current Inference</h2>
            {inferStatus === 'idle' ? (
              <p className="text-text-secondary text-sm">
                No inference running. Go to <Link to="/playground" className="text-accent underline">Playground</Link> to start.
              </p>
            ) : (
              <div className="space-y-2 text-sm">
                <p>Status: <span className={inferStatus === 'running' ? 'text-warning' : 'text-success'}>{inferStatus}</span></p>
                {currentRun && (
                  <>
                    <p className="text-text-muted">Prompt: <span className="text-text-primary">{currentRun.prompt.slice(0, 40)}</span></p>
                    <p>Tokens: {currentRun.tokenCount}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent history */}
      {records.length > 0 && (
        <div className="p-5 bg-surface rounded-lg">
          <h2 className="text-lg font-semibold mb-3">Recent History</h2>
          <ul className="space-y-2">
            {records.slice(0, 5).map(r => (
              <li key={r.id} className="flex items-center justify-between bg-surface-secondary px-3 py-2 rounded text-sm">
                <span className="text-text-muted">{new Date(r.createdAt).toLocaleTimeString()}</span>
                <span className="font-mono text-xs truncate max-w-[200px]">{r.prompt}</span>
                <span className="text-text-secondary">{r.tokenCount} tokens</span>
                <span className="text-text-muted">{r.totalMs}ms</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
