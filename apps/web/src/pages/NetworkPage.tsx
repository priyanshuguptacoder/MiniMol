// src/pages/NetworkPage.tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useSessionStore } from '../stores/useSessionStore';
import { useNetworkStore, PeerEntry } from '../stores/useNetworkStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { signalingClient } from '../services/SignalingClient';
import { getPeerManager } from '../services/PeerManager';
import { RefreshCw, Smartphone, Wifi, AlertCircle, CheckCircle, Activity, Send, ArrowRight } from 'lucide-react';

function StatusPill({ label, status }: { label: string; status?: string }) {
  const isOk = status === 'connected' || status === 'open' || status === 'completed';
  const isPending = status === 'connecting' || status === 'checking' || status === 'new';
  const color = isOk
    ? 'text-success bg-success/10 border-success/30'
    : isPending
    ? 'text-warning bg-warning/10 border-warning/30'
    : 'text-danger bg-danger/10 border-danger/30';

  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-mono ${color}`}>
      {label}: {status || 'unknown'}
    </span>
  );
}

export default function NetworkPage() {
  const session = useSessionStore();
  const { devices, sessionId, myDeviceId, myStageIndex } = session;
  const { peers, transfers, totalBytesSent, totalBytesReceived } = useNetworkStore();
  const settings = useSettingsStore();
  const [diagLog, setDiagLog] = useState<string[]>([]);
  const [testingPeer, setTestingPeer] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ peerId: string; msg: string; success: boolean } | null>(null);

  const addDiag = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDiagLog(prev => [`[${timestamp}] ${msg}`, ...prev.slice(0, 19)]);
  };

  // Sync session and listen to signaling events in real time
  useEffect(() => {
    if (!sessionId) return;

    addDiag(`Listening for peer events on session ${sessionId} (Signaling: ${settings.signalingUrl})`);

    // Fetch latest session view from server on mount
    fetch(`${settings.signalingUrl}/sessions/${sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (data && data.devices && Array.isArray(data.devices)) {
          data.devices.forEach((d: any) => {
            session.addDevice({
              deviceId: d.deviceId,
              socketId: d.socketId,
              capabilities: d.capabilities,
              stageIndex: d.stageIndex,
            });
          });
          addDiag(`Synced ${data.deviceCount} active device(s) from server`);
        }
      })
      .catch(err => {
        addDiag(`Failed to query server session: ${err.message}`);
      });

    // Subscribe to real-time events
    const unsubs = [
      signalingClient.on<{ peerId: string; deviceCount: number; device?: any; devices?: any[] }>(
        'peerJoined',
        ({ peerId, deviceCount, device, devices }) => {
          addDiag(`New peer joined: ${peerId.slice(0, 8)}… (Total: ${deviceCount})`);
          if (devices && Array.isArray(devices)) {
            devices.forEach((d: any) => {
              session.addDevice({
                deviceId: d.deviceId,
                socketId: d.socketId,
                capabilities: d.capabilities,
                stageIndex: d.stageIndex,
              });
            });
          } else {
            session.addDevice({
              deviceId: peerId,
              socketId: peerId,
              capabilities: null,
              stageIndex: device?.stageIndex ?? deviceCount - 1,
            });
          }
        }
      ),
      signalingClient.on<{ peerId: string }>('peerLeft', ({ peerId }) => {
        addDiag(`Peer disconnected: ${peerId.slice(0, 8)}…`);
        session.removeDevice(peerId);
      }),
      signalingClient.on<{ assignments: Array<{ deviceId: string; stageIndex: number; totalDevices: number }> }>(
        'stageAssignment',
        ({ assignments }) => {
          addDiag(`Updated stage assignments across ${assignments.length} device(s)`);
          session.setStageAssignments(assignments);
        }
      ),
      signalingClient.on<{ deviceId: string; caps: any; stageIndex: number }>(
        'capsUpdate',
        ({ deviceId, caps, stageIndex }) => {
          addDiag(`Capabilities updated for ${deviceId.slice(0, 8)}… (Stage ${stageIndex})`);
          session.updateDevice(deviceId, { capabilities: caps, stageIndex });
        }
      ),
    ];

    return () => unsubs.forEach(fn => fn());
  }, [sessionId, settings.signalingUrl]);

  const handleTestTensor = async (peerId: string) => {
    const pm = getPeerManager();
    if (!pm) {
      setTestResult({ peerId, msg: 'PeerManager not initialized', success: false });
      return;
    }
    setTestingPeer(peerId);
    setTestResult(null);
    try {
      // Deterministic 64-element Float32Array
      const testArray = new Float32Array(64).map((_, i) => Math.sin(i * 0.2) * 50);
      const res = await pm.testTensorTransfer(peerId, testArray);
      if (res.success) {
        setTestResult({
          peerId,
          msg: `Success! Transferred ${res.bytes} bytes in ${res.durationMs}ms with 100% element verification.`,
          success: true,
        });
        addDiag(`Test tensor transfer to ${peerId.slice(0, 8)} succeeded (${res.bytes}B in ${res.durationMs}ms)`);
      } else {
        setTestResult({
          peerId,
          msg: `Failed: ${res.error || 'Unknown error'}`,
          success: false,
        });
        addDiag(`Test tensor transfer to ${peerId.slice(0, 8)} failed: ${res.error}`);
      }
    } catch (e: any) {
      setTestResult({ peerId, msg: `Error: ${e.message}`, success: false });
    } finally {
      setTestingPeer(null);
    }
  };

  const handleReconnect = async (peerId: string) => {
    const pm = getPeerManager();
    if (!pm) return;
    addDiag(`Triggering manual reconnect to peer ${peerId.slice(0, 8)}…`);
    try {
      await pm.initiateConnection(peerId, 'successor');
      addDiag(`Offer dispatched to ${peerId.slice(0, 8)}`);
    } catch (err: any) {
      addDiag(`Reconnect failed: ${err.message}`);
    }
  };

  const formatBytes = (b: number) =>
    b < 1024 ? `${b}B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1024 / 1024).toFixed(2)}MB`;

  return (
    <motion.div className="max-w-5xl mx-auto py-8 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">Network & WebRTC Diagnostics</h1>
          <p className="text-text-secondary text-sm">
            Live pipeline topology, adjacent RTCPeerConnection states, ICE negotiation, and binary DataChannel metrics.
          </p>
        </div>
      </div>

      {!sessionId ? (
        <div className="p-8 bg-surface rounded-lg text-center text-text-secondary border border-border">
          No active session. Create or join a session to view cluster network.
        </div>
      ) : (
        <>
          {/* Topology Pipeline Diagram */}
          <div className="p-5 bg-surface rounded-lg border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">4-Stage Pipeline Topology</h2>
              <span className="text-xs text-text-muted">
                Your Stage: <span className="font-bold text-accent">Stage {myStageIndex}</span>
              </span>
            </div>
            {devices.length === 0 ? (
              <p className="text-text-secondary text-sm">Waiting for devices to join…</p>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                {[...devices]
                  .sort((a, b) => a.stageIndex - b.stageIndex)
                  .map((d, i) => {
                    const peer = peers[d.deviceId];
                    const isMe = d.deviceId === myDeviceId;
                    const dcOpen = peer?.channelStatus === 'open';
                    return (
                      <React.Fragment key={d.deviceId}>
                        <div
                          className={`p-3.5 rounded-lg border text-center min-w-[140px] transition-all ${
                            isMe
                              ? 'border-accent bg-accent/10 shadow-sm'
                              : dcOpen
                              ? 'border-success/40 bg-surface-secondary'
                              : 'border-border bg-surface-secondary'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-surface border border-border/50">
                              Stage {d.stageIndex}
                            </span>
                            {isMe ? (
                              <span className="text-[10px] text-accent font-bold px-1 rounded bg-accent/20">YOU</span>
                            ) : (
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  dcOpen ? 'bg-success animate-pulse' : peer?.status === 'connecting' ? 'bg-warning' : 'bg-text-muted'
                                }`}
                              />
                            )}
                          </div>
                          <p className="font-mono text-xs text-text-primary truncate">{d.deviceId.slice(0, 10)}…</p>
                          <div className="mt-2 text-[11px] space-y-0.5 text-text-muted font-mono text-left">
                            <div>ICE: <span className={peer?.iceState === 'connected' ? 'text-success' : 'text-warning'}>{peer?.iceState || 'none'}</span></div>
                            <div>DC: <span className={dcOpen ? 'text-success font-semibold' : 'text-warning'}>{peer?.channelStatus || 'none'}</span></div>
                            {peer?.rttMs !== null && peer?.rttMs !== undefined && (
                              <div>RTT: <span className="text-text-primary">{peer.rttMs}ms</span></div>
                            )}
                          </div>
                        </div>
                        {i < devices.length - 1 && (
                          <div className="flex flex-col items-center">
                            <div className="flex items-center text-text-muted">
                              <span className="text-xs font-mono">WebRTC</span>
                              <ArrowRight size={14} className="ml-0.5" />
                            </div>
                            {transfers.filter(t => t.toDeviceId === devices[i + 1]?.deviceId).length > 0 && (
                              <span className="text-[10px] text-accent font-mono animate-pulse">tensor</span>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Detailed Peer Connections */}
          <div className="p-5 bg-surface rounded-lg border border-border">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Activity size={18} className="text-accent" />
                Active WebRTC Peer Connections ({Object.keys(peers).length})
              </h2>
            </div>

            {Object.keys(peers).length === 0 ? (
              <p className="text-sm text-text-secondary py-2">
                No active WebRTC peer connections yet. Connecting adjacent nodes in the pipeline…
              </p>
            ) : (
              <div className="space-y-3">
                {Object.values(peers).map(p => {
                  const targetDevice = devices.find(d => d.deviceId === p.peerId);
                  const isSuccessor = targetDevice && targetDevice.stageIndex === myStageIndex + 1;
                  const isPredecessor = targetDevice && targetDevice.stageIndex === myStageIndex - 1;
                  const roleLabel = isSuccessor
                    ? `Successor (Stage ${targetDevice.stageIndex})`
                    : isPredecessor
                    ? `Predecessor (Stage ${targetDevice.stageIndex})`
                    : 'Peer';

                  return (
                    <div
                      key={p.peerId}
                      className="bg-surface-secondary border border-border/80 rounded-lg p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-surface rounded border border-border">
                            {p.peerId.slice(0, 14)}…
                          </span>
                          <span className="text-xs text-accent font-medium px-2 py-0.5 bg-accent/10 rounded">
                            {roleLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusPill label="Peer" status={p.status} />
                          <StatusPill label="ICE" status={p.iceState} />
                          <StatusPill label="DC" status={p.channelStatus} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono text-text-muted">
                        <div>
                          <span className="text-text-secondary">Signaling: </span>
                          <span className="text-text-primary">{p.signalingState || 'stable'}</span>
                        </div>
                        <div>
                          <span className="text-text-secondary">Candidate Pair: </span>
                          <span className="text-text-primary">{p.selectedCandidatePair || `${p.localCandidateType || 'host'} ↔ ${p.remoteCandidateType || 'host'}`}</span>
                        </div>
                        <div>
                          <span className="text-text-secondary">RTT: </span>
                          <span className="text-text-primary">{p.rttMs !== null && p.rttMs !== undefined ? `${p.rttMs}ms` : 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-text-secondary">Data Transferred: </span>
                          <span className="text-text-primary">↑{formatBytes(p.bytesSent)} ↓{formatBytes(p.bytesReceived)}</span>
                        </div>
                      </div>

                      {p.error && (
                        <div className="p-2 bg-danger/10 border border-danger/20 rounded text-xs text-danger flex items-center gap-1.5">
                          <AlertCircle size={14} />
                          <span>{p.error}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                        <div className="text-[11px] text-text-muted">
                          Last Handshake: {p.lastHandshake ? new Date(p.lastHandshake).toLocaleTimeString() : 'Pending'}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleReconnect(p.peerId)}
                            className="px-2.5 py-1 text-xs rounded bg-surface hover:bg-surface-secondary border border-border text-text-secondary transition flex items-center gap-1"
                          >
                            <RefreshCw size={12} />
                            Reconnect
                          </button>
                          <button
                            disabled={p.channelStatus !== 'open' || testingPeer === p.peerId}
                            onClick={() => handleTestTensor(p.peerId)}
                            className="px-2.5 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition flex items-center gap-1 font-medium"
                          >
                            <Send size={12} />
                            {testingPeer === p.peerId ? 'Verifying…' : 'Send Test Float32Array'}
                          </button>
                        </div>
                      </div>

                      {testResult && testResult.peerId === p.peerId && (
                        <div
                          className={`p-2 rounded text-xs flex items-center gap-1.5 ${
                            testResult.success
                              ? 'bg-success/10 text-success border border-success/30'
                              : 'bg-danger/10 text-danger border border-danger/30'
                          }`}
                        >
                          {testResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                          <span>{testResult.msg}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Global Network Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Transferred (Sent)', value: formatBytes(totalBytesSent) },
              { label: 'Total Transferred (Received)', value: formatBytes(totalBytesReceived) },
              { label: 'Tensor Transmissions', value: transfers.length },
              { label: 'Adjacent WebRTC Peers', value: Object.keys(peers).length },
            ].map(({ label, value }) => (
              <div key={label} className="p-4 bg-surface rounded-lg border border-border text-center">
                <p className="text-text-muted text-xs">{label}</p>
                <p className="text-xl font-semibold mt-1 text-text-primary">{value}</p>
              </div>
            ))}
          </div>

          {/* Diagnostic Log & Connection Status */}
          <div className="p-4 bg-surface rounded-lg border border-border/80 text-xs font-mono space-y-2">
            <div className="flex flex-wrap items-center justify-between text-text-secondary pb-2 border-b border-border/40 gap-2">
              <span className="flex items-center gap-1.5 font-semibold text-text-primary">
                <Wifi size={14} className={signalingClient.isConnected ? 'text-success' : 'text-danger'} />
                Socket.IO: {signalingClient.isConnected ? 'Connected' : 'Disconnected'}
              </span>
              <span>Signaling Endpoint: <span className="text-text-primary">{settings.signalingUrl}</span></span>
              <span>Session ID: <span className="text-accent font-bold">{sessionId}</span></span>
              <span>Registered Devices: <span className="text-success font-bold">{devices.length}</span></span>
            </div>
            {diagLog.length > 0 && (
              <div className="space-y-1 text-text-muted max-h-36 overflow-auto pt-1">
                {diagLog.map((log, idx) => (
                  <div key={idx} className="leading-tight">{log}</div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
