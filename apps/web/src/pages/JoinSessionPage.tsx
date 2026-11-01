// src/pages/JoinSessionPage.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Send, Loader2, AlertCircle, CheckCircle, Smartphone, ArrowRight, Layers, Wifi, Terminal } from 'lucide-react';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { signalingClient } from '../services/SignalingClient';
import { useSessionStore } from '../stores/useSessionStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useDeviceStore } from '../stores/useDeviceStore';

export default function JoinSessionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const [myStage, setMyStage] = useState<number | null>(null);
  const [registeredDeviceId, setRegisteredDeviceId] = useState<string>('');
  const [diagLogs, setDiagLogs] = useState<string[]>([]);

  const settings = useSettingsStore();
  const { setSession } = useSessionStore();
  const { discoverCapabilities } = useDeviceStore();

  const addDiag = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDiagLogs(prev => [`[${timestamp}] ${msg}`, ...prev.slice(0, 7)]);
  };

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      setSessionId(code.toUpperCase().trim());
      addDiag(`Room code auto-populated from URL: ${code.toUpperCase().trim()}`);
    }
    addDiag(`Configured Signaling URL: ${settings.signalingUrl}`);
  }, [searchParams, settings.signalingUrl]);

  const handleJoin = async () => {
    if (!sessionId.trim()) return;
    setJoining(true);
    setError('');
    const code = sessionId.trim().toUpperCase();
    addDiag(`Initiating socket connection to ${settings.signalingUrl}…`);

    try {
      await signalingClient.connect(settings.signalingUrl);
      addDiag(`Socket connected successfully (ID: ${signalingClient.socketId})`);

      addDiag(`Emitting joinSession for room: ${code}…`);
      const res = await signalingClient.joinSession(code);
      const { deviceId, stageIndex, session: sessView } = res;

      addDiag(`Device registration confirmed! Device ID: ${deviceId.slice(0, 8)}…, Stage: ${stageIndex}`);
      setRegisteredDeviceId(deviceId);
      setMyStage(stageIndex);

      const caps = discoverCapabilities();
      addDiag(`Reporting device hardware capabilities (${caps.cpuCores} cores, WASM=${caps.supportsWasm})`);
      signalingClient.sendCapabilities(code, caps);

      const allDevices = (sessView && sessView.devices && Array.isArray(sessView.devices))
        ? sessView.devices.map((d: any) => ({
            deviceId: d.deviceId,
            socketId: d.socketId,
            capabilities: d.capabilities,
            stageIndex: d.stageIndex,
          }))
        : [{ deviceId, socketId: deviceId, capabilities: caps, stageIndex }];

      setSession({
        sessionId: code,
        myDeviceId: deviceId,
        myStageIndex: stageIndex,
        isHost: false,
        status: 'waiting',
        devices: allDevices,
      });

      if (settings.enableHeartbeat) {
        signalingClient.startHeartbeat(settings.heartbeatIntervalMs);
      }
      setJoined(true);
      addDiag(`Successfully joined cluster session ${code}!`);
    } catch (e: any) {
      const errStr = e?.message || String(e);
      addDiag(`[ERROR] Join request failed: ${errStr}`);

      if (errStr.includes('connect_error') || errStr.includes('timeout') || errStr.includes('Not connected')) {
        setError(`Signaling server unreachable at ${settings.signalingUrl}. Ensure phone is on the same Wi-Fi network.`);
      } else if (errStr.includes('Session not found')) {
        setError(`Invalid or expired session code "${code}". Please check the room code on the host screen.`);
      } else if (errStr.includes('Session full')) {
        setError(`Room full: This session has reached its maximum device capacity.`);
      } else if (errStr.includes('Session ended')) {
        setError(`Session ended: The host has terminated this cluster session.`);
      } else if (errStr.includes('Rate limited')) {
        setError(`Join request rejected: Rate limited. Please wait 10 seconds before retrying.`);
      } else {
        setError(`Device registration failed: ${errStr}`);
      }
    } finally {
      setJoining(false);
    }
  };

  if (joined && myStage !== null) {
    return (
      <motion.div
        className="max-w-2xl mx-auto py-8 space-y-6"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="p-6 bg-surface border border-emerald-500/40 rounded-xl space-y-5">
          <div className="flex items-center gap-2 text-emerald-400 text-lg font-semibold">
            <CheckCircle size={22} /> Connected to Cluster Session!
          </div>

          <div className="bg-surface-secondary p-4 rounded-lg border border-border space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-text-secondary">Session ID:</span>
              <span className="font-mono text-accent font-bold tracking-wider">{sessionId}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-text-secondary">Your Assigned Partition:</span>
              <span className="font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">
                Stage {myStage}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-text-secondary">Registered Device ID:</span>
              <span className="font-mono text-text-primary text-xs">{registeredDeviceId}</span>
            </div>
          </div>

          {/* Diagnostic Log */}
          <div className="p-3 bg-surface-secondary/70 rounded-lg text-xs font-mono space-y-1.5 border border-border/40">
            <div className="flex items-center justify-between font-semibold text-text-primary pb-1 border-b border-border/30">
              <span className="flex items-center gap-1.5">
                <Wifi size={13} className="text-emerald-400" /> Socket: Connected
              </span>
              <span className="text-text-muted text-[11px]">{settings.signalingUrl}</span>
            </div>
            <div className="space-y-0.5 text-text-muted pt-1 max-h-24 overflow-auto">
              {diagLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-surface-secondary/60 rounded-lg text-xs text-text-secondary leading-relaxed border border-border/40">
            <p className="font-medium text-text-primary mb-1 flex items-center gap-1.5">
              <Layers size={14} className="text-accent" /> Device Responsibility:
            </p>
            This phone is registered to compute Transformer Block #{myStage}. When the host initiates an inference run, activations will be received via WebRTC DataChannel, computed in WASM, and forwarded to the next peer.
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={() => navigate(`/sessions/${sessionId}`)} className="flex-1 flex items-center justify-center gap-2">
              View Cluster State <ArrowRight size={16} />
            </Button>
            <Button onClick={() => navigate('/network')} className="flex-1 bg-surface-secondary hover:bg-surface-tertiary border border-border">
              View Network
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold mb-1">Join Inference Session</h1>
        <p className="text-text-secondary text-sm">
          Connect this phone or laptop as a compute node in an active SplitInfer session.
        </p>
      </motion.div>

      <motion.div className="p-6 bg-surface border border-border rounded-xl space-y-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Input
          label="Session ID (Room Code)"
          placeholder="SI-XXXXXX"
          value={sessionId}
          onChange={e => setSessionId(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
        />

        <p className="text-text-muted text-xs">
          Connecting to signaling server at <span className="font-mono text-text-primary">{settings.signalingUrl}</span>
        </p>

        {error && (
          <div className="flex items-start gap-2.5 text-danger text-sm bg-danger/10 border border-danger/20 p-3 rounded-lg leading-snug">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to Join Session</p>
              <p className="text-xs text-text-secondary mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Diagnostic Logs before join */}
        {diagLogs.length > 0 && (
          <div className="p-3 bg-surface-secondary/60 rounded-lg text-xs font-mono border border-border/40 text-text-muted space-y-1">
            <div className="font-semibold text-text-secondary pb-1 border-b border-border/30 flex items-center gap-1.5">
              <Terminal size={12} /> Diagnostics Log
            </div>
            {diagLogs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        )}

        <Button
          onClick={handleJoin}
          disabled={joining || !sessionId.trim()}
          className="w-full flex justify-center items-center gap-2 py-3"
        >
          {joining ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          {joining ? 'Connecting to Cluster…' : 'Join as Compute Node'}
        </Button>
      </motion.div>
    </div>
  );
}
