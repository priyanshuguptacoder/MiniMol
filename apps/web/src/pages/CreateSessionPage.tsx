// src/pages/CreateSessionPage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  PlusCircle,
  Copy,
  CheckCircle,
  Users,
  Loader2,
  AlertCircle,
  QrCode as QrIcon,
  ExternalLink,
  Cpu
} from 'lucide-react';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { QRCode } from '../components/QRCode';
import { signalingClient } from '../services/SignalingClient';
import { useSessionStore } from '../stores/useSessionStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useDeviceStore } from '../stores/useDeviceStore';

export default function CreateSessionPage() {
  const navigate = useNavigate();
  const [maxDevices, setMaxDevices] = useState('4');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(true);

  const settings = useSettingsStore();
  const session = useSessionStore();
  const { setSession, devices } = session;
  const { discoverCapabilities } = useDeviceStore();

  React.useEffect(() => {
    if (!sessionId) return;
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
      signalingClient.on<{ deviceId: string; caps: any; stageIndex: number }>(
        'capsUpdate', ({ deviceId, caps, stageIndex }) => {
          session.updateDevice(deviceId, { capabilities: caps, stageIndex });
        }
      ),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [sessionId, session]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      await signalingClient.connect(settings.signalingUrl);
      const { sessionId: sid, deviceId } = await signalingClient.createSession(Number(maxDevices) || 4);
      setSessionId(sid);

      const caps = discoverCapabilities();
      signalingClient.sendCapabilities(sid, caps);

      setSession({
        sessionId: sid,
        myDeviceId: deviceId,
        hostId: deviceId,
        isHost: true,
        status: 'waiting',
        devices: [{ deviceId, socketId: deviceId, capabilities: caps, stageIndex: 0 }],
        totalDevices: 1,
      });

      if (settings.enableHeartbeat) {
        signalingClient.startHeartbeat(settings.heartbeatIntervalMs);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const joinUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/sessions/join?code=${sessionId}`
    : '';

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold mb-1">Create Inference Session</h1>
        <p className="text-text-secondary text-sm">
          Initialize a decentralized cluster session. Invite phones and laptops to execute Transformer blocks.
        </p>
      </motion.div>

      {!sessionId ? (
        <motion.div
          className="p-6 bg-surface border border-border rounded-xl space-y-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <Input
            label="Maximum Devices in Cluster (Pipeline Depth)"
            type="number"
            min={1}
            max={8}
            value={maxDevices}
            onChange={e => setMaxDevices(e.target.value)}
          />
          <p className="text-text-muted text-xs">
            Signaling relay endpoint: <span className="font-mono text-text-primary">{settings.signalingUrl}</span>
          </p>

          {error && (
            <div className="flex items-center gap-2 text-danger text-sm bg-danger/10 border border-danger/20 p-3 rounded-lg">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <Button onClick={handleCreate} disabled={creating} className="w-full flex justify-center items-center gap-2 py-3">
            {creating ? <Loader2 size={18} className="animate-spin" /> : <PlusCircle size={18} />}
            {creating ? 'Negotiating Session with Relay…' : 'Initialize Session'}
          </Button>
        </motion.div>
      ) : (
        <motion.div
          className="p-6 bg-surface border border-border rounded-xl space-y-6"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <div className="flex flex-wrap items-center justify-between bg-surface-secondary/70 p-3 rounded-lg border border-border/40 gap-2">
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <CheckCircle size={18} /> Session initialized! Host device assigned to <strong className="text-white">Stage 0</strong>
            </div>
            <span className="text-xs font-mono bg-accent/10 text-accent px-2.5 py-1 rounded-full border border-accent/20 font-bold">
              {devices.length} / {maxDevices} Device(s) Joined
            </span>
          </div>

          {/* Session Code & Link */}
          <div className="space-y-3">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-text-muted block mb-1">Room Code</span>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-2xl font-bold tracking-widest bg-surface-secondary border border-border rounded-lg px-4 py-2.5 text-accent select-all text-center">
                  {sessionId}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="p-3 bg-surface-secondary border border-border hover:border-accent rounded-lg transition"
                  title="Copy session code"
                >
                  {copied ? <CheckCircle size={18} className="text-emerald-400" /> : <Copy size={18} />}
                </button>
              </div>
            </div>

            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-text-muted block mb-1">Direct Mobile Join Link</span>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={joinUrl}
                  className="flex-1 text-xs font-mono bg-surface-secondary border border-border rounded-lg px-3 py-2 text-text-secondary select-all"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-surface-secondary border border-border hover:border-accent rounded-lg text-xs font-mono transition"
                >
                  Copy Link
                </button>
              </div>
            </div>
          </div>

          {/* QR Code for instant phone joining */}
          <div className="p-4 bg-surface-secondary border border-border rounded-xl flex flex-col sm:flex-row items-center gap-5">
            <div className="shrink-0">
              <QRCode value={joinUrl} size={150} />
            </div>
            <div className="space-y-2 text-center sm:text-left">
              <h3 className="font-semibold text-sm flex items-center justify-center sm:justify-start gap-1.5">
                <QrIcon size={16} className="text-accent" /> Scan with Phone Camera
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed">
                Point your phone's camera at this QR code to join this session directly.
                Ensure both devices are on the same Wi-Fi network.
              </p>
              <span className="inline-block text-[11px] font-mono text-text-muted">
                Host IP: {window.location.hostname}
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={() => navigate(`/sessions/${sessionId}`)} className="flex-1">
              View Cluster State
            </Button>
            <Button
              onClick={() => navigate('/playground')}
              className="flex-1 bg-surface-secondary hover:bg-surface-tertiary border border-border"
            >
              Open Playground
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
