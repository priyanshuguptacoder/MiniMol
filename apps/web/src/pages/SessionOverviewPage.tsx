// src/pages/SessionOverviewPage.tsx
import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, Cpu, CheckCircle, AlertCircle, Play, Square } from 'lucide-react';
import { Button } from '../components/Button';
import { useSessionStore } from '../stores/useSessionStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { signalingClient } from '../services/SignalingClient';

export default function SessionOverviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const session = useSessionStore();
  const network = useNetworkStore();
  const settings = useSettingsStore();

  // Subscribe to signaling events on mount
  useEffect(() => {
    if (!signalingClient.isConnected) return;
    const unsubs = [
      signalingClient.on<{ peerId: string; deviceCount: number }>('peerJoined', ({ peerId, deviceCount }) => {
        session.addDevice({ deviceId: peerId, socketId: peerId, capabilities: null, stageIndex: deviceCount - 1 });
      }),
      signalingClient.on<{ peerId: string }>('peerLeft', ({ peerId }) => {
        session.removeDevice(peerId);
      }),
      signalingClient.on<{ assignments: Array<{ deviceId: string; stageIndex: number; totalDevices: number }> }>(
        'stageAssignment', ({ assignments }) => {
          session.setStageAssignments(assignments);
        }
      ),
      signalingClient.on<{ deviceId: string; caps: object; stageIndex: number }>(
        'capsUpdate', ({ deviceId, caps, stageIndex }) => {
          session.updateDevice(deviceId, { capabilities: caps as never, stageIndex });
        }
      ),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [session]);

  const connectedPeers = Object.values(network.peers).filter(p => p.status === 'connected');

  if (!session.sessionId) {
    return (
      <div className="max-w-2xl mx-auto py-8 text-center">
        <AlertCircle className="mx-auto mb-4 text-warning" size={40} />
        <p className="text-text-secondary mb-4">No active session. Create or join one first.</p>
        <Button onClick={() => navigate('/sessions/create')}>Create Session</Button>
      </div>
    );
  }

  return (
    <motion.div className="max-w-4xl mx-auto py-8 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Session Overview</h1>
          <p className="text-text-muted font-mono text-sm mt-1">{session.sessionId}</p>
        </div>
        <span className={`px-3 py-1 text-xs rounded-full ${
          session.status === 'active' ? 'bg-success/20 text-success' :
          session.status === 'waiting' ? 'bg-warning/20 text-warning' :
          'bg-surface-secondary text-text-muted'
        }`}>
          {session.status.toUpperCase()}
        </span>
      </div>

      {/* Devices */}
      <div className="p-5 bg-surface rounded-lg">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users size={18} /> Devices ({session.devices.length} / {settings.maxDevices})
        </h2>
        {session.devices.length === 0 ? (
          <p className="text-text-secondary text-sm">Waiting for devices to join…</p>
        ) : (
          <div className="space-y-3">
            {session.devices.map(d => {
              const peer = network.peers[d.deviceId];
              return (
                <div key={d.deviceId} className="flex items-center justify-between bg-surface-secondary px-4 py-3 rounded">
                  <div className="flex items-center gap-3">
                    <Cpu size={18} className="text-accent" />
                    <div>
                      <p className="font-mono text-xs">{d.deviceId.slice(0, 16)}…</p>
                      {d.deviceId === session.myDeviceId && (
                        <span className="text-xs text-accent">← This device</span>
                      )}
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-sm text-text-secondary">Stage</span>
                    <p className="font-bold text-accent">{d.stageIndex}</p>
                  </div>
                  <div className="text-right text-xs text-text-secondary">
                    <p>{d.capabilities ? `${d.capabilities.cpuCores} cores` : 'Caps N/A'}</p>
                    <p>{peer ? (
                      peer.status === 'connected'
                        ? <span className="text-success">●  Connected</span>
                        : peer.status
                    ) : (d.deviceId === session.myDeviceId ? 'Local' : 'Pending')}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      {session.isHost && (
        <div className="p-5 bg-surface rounded-lg space-y-3">
          <h2 className="text-lg font-semibold">Session Controls</h2>
          <div className="flex gap-3">
            <Button
              onClick={() => navigate('/playground')}
              className="flex items-center gap-2"
            >
              <Play size={16} /> Start Inference
            </Button>
            <Button
              onClick={() => {
                signalingClient.disconnect();
                session.reset();
                navigate('/dashboard');
              }}
              className="flex items-center gap-2 bg-danger/20 text-danger hover:bg-danger/30"
            >
              <Square size={16} /> End Session
            </Button>
          </div>
        </div>
      )}

      {/* Peer connections */}
      {connectedPeers.length > 0 && (
        <div className="p-5 bg-surface rounded-lg">
          <h2 className="text-lg font-semibold mb-3">WebRTC Connections</h2>
          <div className="space-y-2">
            {connectedPeers.map(p => (
              <div key={p.peerId} className="flex items-center justify-between text-sm bg-surface-secondary px-3 py-2 rounded">
                <span className="font-mono text-xs">{p.peerId.slice(0, 12)}…</span>
                <span className="text-success flex items-center gap-1"><CheckCircle size={14} /> Connected</span>
                <span className="text-text-muted">RTT: {p.rttMs !== null ? `${p.rttMs}ms` : 'N/A'}</span>
                <span className="text-text-muted">↑{(p.bytesSent / 1024).toFixed(1)}KB ↓{(p.bytesReceived / 1024).toFixed(1)}KB</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
