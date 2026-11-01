// apps/signaling-server/src/server.js
// Full signaling server for SplitInfer distributed inference
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '64kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6, // 1MB
});

// ─── In-memory session registry ──────────────────────────────────────────────
/**
 * Session shape:
 *  { id, hostId, maxDevices, devices: Map<socketId, DeviceInfo>, createdAt, status }
 * DeviceInfo: { socketId, deviceId, capabilities, stageIndex }
 */
const sessions = new Map(); // sessionId → session

const MAX_DEVICES = 4;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

function generateId(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── HTTP routes ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  service: 'splitinfer-signaling',
  sessions: sessions.size,
  uptime: Math.round(process.uptime()),
}));

app.post('/sessions', (req, res) => {
  const { maxDevices = MAX_DEVICES } = req.body || {};
  const id = generateId('SI-');
  sessions.set(id, {
    id,
    hostId: null,
    maxDevices: Math.min(Math.max(Number(maxDevices) || MAX_DEVICES, 1), 8),
    devices: new Map(),
    createdAt: Date.now(),
    status: 'waiting', // waiting | active | ended
  });
  res.json({ sessionId: id });
});

app.get('/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(sessionView(session));
});

function sessionView(s) {
  return {
    id: s.id,
    hostId: s.hostId,
    maxDevices: s.maxDevices,
    deviceCount: s.devices.size,
    devices: [...s.devices.values()].map(d => ({
      deviceId: d.deviceId,
      socketId: d.socketId,
      capabilities: d.capabilities,
      stageIndex: d.stageIndex,
    })),
    status: s.status,
    createdAt: s.createdAt,
  };
}

// ─── Socket.IO events ─────────────────────────────────────────────────────────
// Rate-limiting: simple per-socket event counter
const eventCounts = new Map();
const RATE_LIMIT = 200; // events per minute
function isRateLimited(socketId) {
  const now = Date.now();
  let entry = eventCounts.get(socketId);
  if (!entry || now - entry.window > 60_000) {
    entry = { count: 1, window: now };
    eventCounts.set(socketId, entry);
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

io.on('connection', socket => {
  console.log('[SIG] connected:', socket.id);

  let heartbeatTimer = null;
  let lastHeartbeat = Date.now();

  function resetHeartbeat() {
    lastHeartbeat = Date.now();
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      console.log('[SIG] heartbeat timeout:', socket.id);
      socket.disconnect(true);
    }, HEARTBEAT_TIMEOUT_MS);
  }

  resetHeartbeat();

  // ── createSession ──────────────────────────────────────────────────────────
  socket.on('createSession', ({ maxDevices = MAX_DEVICES } = {}, ack) => {
    if (isRateLimited(socket.id)) return ack?.({ error: 'Rate limited' });
    const id = generateId('SI-');
    const session = {
      id,
      hostId: socket.id,
      maxDevices: Math.min(Math.max(Number(maxDevices) || MAX_DEVICES, 1), 8),
      devices: new Map(),
      createdAt: Date.now(),
      status: 'waiting',
    };
    sessions.set(id, session);
    socket.join(id);
    // Register host as first device
    const hostDevice = {
      socketId: socket.id,
      deviceId: socket.id,
      capabilities: null,
      stageIndex: 0,
      sessionId: id,
    };
    session.devices.set(socket.id, hostDevice);
    socket._sessionId = id;
    console.log('[SIG] createSession:', id, 'host:', socket.id);
    ack?.({ sessionId: id, deviceId: socket.id });
  });

  // ── joinSession ────────────────────────────────────────────────────────────
  socket.on('joinSession', ({ sessionId } = {}, ack) => {
    if (isRateLimited(socket.id)) return ack?.({ error: 'Rate limited' });
    const session = sessions.get(sessionId);
    if (!session) return ack?.({ error: 'Session not found' });
    if (session.status === 'ended') return ack?.({ error: 'Session ended' });
    if (session.devices.size >= session.maxDevices) return ack?.({ error: 'Session full' });

    socket.join(sessionId);
    const device = {
      socketId: socket.id,
      deviceId: socket.id,
      capabilities: null,
      stageIndex: session.devices.size, // assign next available slot
      sessionId,
    };
    session.devices.set(socket.id, device);
    socket._sessionId = sessionId;

    // Notify existing peers with complete updated device list
    const currentView = sessionView(session);
    socket.to(sessionId).emit('peerJoined', {
      peerId: socket.id,
      deviceCount: session.devices.size,
      device,
      devices: currentView.devices,
    });

    console.log('[SIG] joinSession:', sessionId, 'peer:', socket.id, 'total:', session.devices.size);
    ack?.({ ok: true, deviceId: socket.id, sessionId, stageIndex: device.stageIndex, session: currentView });
  });

  // ── getSession ─────────────────────────────────────────────────────────────
  socket.on('getSession', ({ sessionId } = {}, ack) => {
    const session = sessions.get(sessionId);
    if (!session) return ack?.({ error: 'Session not found' });
    ack?.({ session: sessionView(session) });
  });

  // ── capabilities ──────────────────────────────────────────────────────────
  socket.on('capabilities', ({ sessionId, caps } = {}) => {
    if (isRateLimited(socket.id)) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    const device = session.devices.get(socket.id);
    if (!device) return;
    device.capabilities = caps;
    // Broadcast updated capabilities to all in room
    io.to(sessionId).emit('capsUpdate', {
      deviceId: socket.id,
      caps,
      stageIndex: device.stageIndex,
      deviceCount: session.devices.size,
    });
    // If all devices reported caps, broadcast stage assignments
    assignStages(session);
  });

  function assignStages(session) {
    const devicesWithCaps = [...session.devices.values()].filter(d => d.capabilities !== null);
    if (devicesWithCaps.length !== session.devices.size) return; // wait for all
    // Simple equal assignment
    const total = devicesWithCaps.length;
    devicesWithCaps.forEach((d, i) => { d.stageIndex = i; });
    const assignments = devicesWithCaps.map(d => ({
      deviceId: d.socketId,
      stageIndex: d.stageIndex,
      totalDevices: total,
    }));
    io.to(session.id).emit('stageAssignment', { assignments, totalDevices: total });
    console.log('[SIG] stageAssignment for', session.id, assignments.map(a => a.stageIndex));
  }

  // ── SDP offer/answer ──────────────────────────────────────────────────────
  socket.on('sdpOffer', ({ to, sdp, sessionId } = {}, ack) => {
    if (isRateLimited(socket.id)) return ack?.({ error: 'Rate limited' });
    const targetSocket = io.sockets.sockets.get(to);
    if (!targetSocket) {
      console.warn(`[SIG] sdpOffer target ${to} not found for session ${sessionId}`);
      return ack?.({ error: `Target socket ${to} not found` });
    }
    targetSocket.emit('sdpOffer', { from: socket.id, sdp, sessionId });
    console.log(`[SIG] sdpOffer routed: ${socket.id.slice(0, 6)} -> ${to.slice(0, 6)}`);
    ack?.({ ok: true });
  });

  socket.on('sdpAnswer', ({ to, sdp, sessionId } = {}, ack) => {
    if (isRateLimited(socket.id)) return ack?.({ error: 'Rate limited' });
    const targetSocket = io.sockets.sockets.get(to);
    if (!targetSocket) {
      console.warn(`[SIG] sdpAnswer target ${to} not found for session ${sessionId}`);
      return ack?.({ error: `Target socket ${to} not found` });
    }
    targetSocket.emit('sdpAnswer', { from: socket.id, sdp, sessionId });
    console.log(`[SIG] sdpAnswer routed: ${socket.id.slice(0, 6)} -> ${to.slice(0, 6)}`);
    ack?.({ ok: true });
  });

  // ── ICE candidates ────────────────────────────────────────────────────────
  socket.on('iceCandidate', ({ to, candidate, sessionId } = {}, ack) => {
    if (isRateLimited(socket.id)) return ack?.({ error: 'Rate limited' });
    const targetSocket = io.sockets.sockets.get(to);
    if (!targetSocket) {
      return ack?.({ error: `Target socket ${to} not found` });
    }
    targetSocket.emit('iceCandidate', { from: socket.id, candidate, sessionId });
    ack?.({ ok: true });
  });

  // ── heartbeat ─────────────────────────────────────────────────────────────
  socket.on('heartbeat', (_, ack) => {
    resetHeartbeat();
    ack?.({ pong: Date.now() });
  });

  // ── startInference ────────────────────────────────────────────────────────
  socket.on('startInference', ({ sessionId, prompt } = {}) => {
    const session = sessions.get(sessionId);
    if (!session || session.hostId !== socket.id) return;
    session.status = 'active';
    io.to(sessionId).emit('inferenceStart', { prompt, startedAt: Date.now() });
  });

  // ── inferenceComplete ─────────────────────────────────────────────────────
  socket.on('inferenceComplete', ({ sessionId, result, metrics } = {}) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    io.to(sessionId).emit('inferenceResult', { result, metrics, completedAt: Date.now() });
    session.status = 'waiting';
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    clearTimeout(heartbeatTimer);
    eventCounts.delete(socket.id);
    const sessionId = socket._sessionId;
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    session.devices.delete(socket.id);
    io.to(sessionId).emit('peerLeft', {
      peerId: socket.id,
      deviceCount: session.devices.size,
    });
    // Clean up empty sessions after a grace period to tolerate temporary reconnects
    if (session.devices.size === 0) {
      setTimeout(() => {
        const s = sessions.get(sessionId);
        if (s && s.devices.size === 0) {
          sessions.delete(sessionId);
          console.log('[SIG] session cleaned up after grace period:', sessionId);
        }
      }, 60_000);
    } else if (session.hostId === socket.id) {
      // Reassign host to first remaining device
      const nextHost = session.devices.keys().next().value;
      session.hostId = nextHost;
      io.to(sessionId).emit('hostChanged', { newHostId: nextHost });
    }
    console.log('[SIG] disconnect:', socket.id, 'session:', sessionId, 'remaining:', session.devices.size);
  });
});

// ─── Periodic cleanup of stale sessions ──────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff && session.devices.size === 0) {
      sessions.delete(id);
      console.log('[SIG] cleaned up stale session:', id);
    }
  }
}, 60_000);

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SIG] Signaling server listening on http://0.0.0.0:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`[SIG] Received ${signal}. Closing signaling server...`);
  io.close(() => {
    server.close(() => {
      console.log('[SIG] HTTP server closed cleanly.');
      process.exit(0);
    });
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
