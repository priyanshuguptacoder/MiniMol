// src/services/PeerManager.ts
// Manages RTCPeerConnections and DataChannels for tensor transport
import { signalingClient } from './SignalingClient';
import { useNetworkStore, PeerStatus, ChannelStatus } from '../stores/useNetworkStore';

export interface PeerManagerConfig {
  sessionId: string;
  myDeviceId: string;
  stunUrls: string[];
  turnUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
  onTensorReceived: (stageIndex: number, tensor: Float32Array) => void;
}

const DC_LABEL = 'tensor';

export class PeerManager {
  private config: PeerManagerConfig;
  private connections: Map<string, RTCPeerConnection> = new Map();
  private channels: Map<string, RTCDataChannel> = new Map();
  private pendingBuffers: Map<string, ArrayBuffer[]> = new Map();
  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private pingTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private statsTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private testResolvers: Map<string | number, (res: { ok: boolean; bytes: number; error?: string }) => void> = new Map();
  private tensorListeners: Array<(stageIndex: number, tensor: Float32Array) => void> = [];
  private testCounter = 1;
  private unsubs: Array<() => void> = [];

  constructor(config: PeerManagerConfig) {
    this.config = config;
    this.registerSignalingHandlers();
    console.log(`[PeerManager] Initialized for session ${config.sessionId}, device ${config.myDeviceId}`);
  }

  onTensor(fn: (stageIndex: number, tensor: Float32Array) => void): () => void {
    this.tensorListeners.push(fn);
    return () => {
      this.tensorListeners = this.tensorListeners.filter(f => f !== fn);
    };
  }

  getConfig(): PeerManagerConfig {
    return this.config;
  }

  getConnection(peerId: string): RTCPeerConnection | undefined {
    return this.connections.get(peerId);
  }

  getDataChannel(peerId: string): RTCDataChannel | undefined {
    return this.channels.get(peerId);
  }

  private getIceConfig(): RTCConfiguration {
    const urls = new Set<string>([
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
    ]);

    if (this.config.stunUrls && this.config.stunUrls.length > 0) {
      for (const u of this.config.stunUrls) {
        if (u && typeof u === 'string') urls.add(u.trim());
      }
    }

    const iceServers: RTCIceServer[] = [
      { urls: Array.from(urls) }
    ];

    const turnUrl = this.config.turnUrl || ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TURN_URL) || '');
    const turnUsername = this.config.turnUsername || ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TURN_USERNAME) || '');
    const turnCredential = this.config.turnCredential || ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TURN_CREDENTIAL) || '');

    if (turnUrl) {
      iceServers.push({
        urls: turnUrl.includes(',') ? turnUrl.split(',').map((s: string) => s.trim()) : turnUrl,
        username: turnUsername || undefined,
        credential: turnCredential || undefined,
      });
    }

    return {
      iceServers,
      iceCandidatePoolSize: 2,
    };
  }

  private createPeerConnection(peerId: string, role: 'successor' | 'predecessor' | 'peer' = 'peer'): RTCPeerConnection {
    // If an existing healthy or connecting connection exists, do not recreate it
    const existing = this.connections.get(peerId);
    if (existing) {
      if (existing.connectionState === 'connected' || existing.iceConnectionState === 'connected') {
        console.log(`[PeerManager] Preserving healthy active connection for ${peerId}`);
        return existing;
      }
      console.log(`[PeerManager] Cleaning up existing non-connected connection for ${peerId}`);
      this.cleanupPeer(peerId, false);
    }

    const pc = new RTCPeerConnection(this.getIceConfig());
    this.connections.set(peerId, pc);

    const prevPeer = useNetworkStore.getState().peers[peerId];
    if (!prevPeer) {
      useNetworkStore.getState().addPeer(peerId);
    }
    useNetworkStore.getState().updatePeer(peerId, {
      connection: pc,
      status: 'connecting',
      iceState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      signalingState: pc.signalingState,
      iceGatheringState: pc.iceGatheringState,
      channelStatus: prevPeer?.channelStatus || 'connecting',
      role,
      error: null,
    });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        const match = candidate.candidate.match(/typ\s+([a-zA-Z0-9]+)/i);
        const typ = match ? match[1] : undefined;
        if (typ) {
          useNetworkStore.getState().updatePeer(peerId, { localCandidateType: typ });
        }
        signalingClient.sendIceCandidate(peerId, candidate.toJSON(), this.config.sessionId);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[PeerManager] [${peerId.slice(0, 8)}] iceGatheringState: ${pc.iceGatheringState}`);
      useNetworkStore.getState().updatePeer(peerId, { iceGatheringState: pc.iceGatheringState });
    };

    pc.onsignalingstatechange = () => {
      console.log(`[PeerManager] [${peerId.slice(0, 8)}] signalingState: ${pc.signalingState}`);
      useNetworkStore.getState().updatePeer(peerId, { signalingState: pc.signalingState });
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`[PeerManager] [${peerId.slice(0, 8)}] iceConnectionState: ${iceState}`);
      useNetworkStore.getState().updatePeer(peerId, { iceState });

      if (iceState === 'connected' || iceState === 'completed') {
        // Clear any transient warnings once connected
        useNetworkStore.getState().updatePeer(peerId, { error: null });
        this.pollCandidatePair(peerId, pc);
      } else if (iceState === 'failed') {
        useNetworkStore.getState().updatePeer(peerId, {
          status: 'failed',
          error: 'ICE connection failed (NAT/Firewall issue or unroutable candidate)',
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const connState = pc.connectionState;
      console.log(`[PeerManager] [${peerId.slice(0, 8)}] connectionState: ${connState}`);

      const status: PeerStatus =
        connState === 'connected' ? 'connected' :
        connState === 'failed' ? 'failed' :
        connState === 'closed' ? 'closed' : 'connecting';

      useNetworkStore.getState().updatePeer(peerId, {
        connectionState: connState,
        status,
        lastHandshake: connState === 'connected' ? Date.now() : undefined,
        ...(connState === 'connected' ? { error: null } : {}),
      });

      if (connState === 'connected') {
        this.pollCandidatePair(peerId, pc);
        this.startPeriodicStats(peerId, pc);
      } else if (connState === 'failed') {
        this.stopPeriodicStats(peerId);
        useNetworkStore.getState().updatePeer(peerId, { error: 'Peer connection failed' });
      } else if (connState === 'closed') {
        this.stopPeriodicStats(peerId);
      }
    };

    pc.onicecandidateerror = (e: any) => {
      // Benign candidate warnings (e.g., STUN binding timeout 701 on secondary server)
      // must NOT corrupt an otherwise active or connecting peer state.
      console.warn(`[PeerManager] [${peerId.slice(0, 8)}] ICE candidate note (code ${e.errorCode}):`, e.errorText || 'STUN timeout');
      if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed' && e.errorCode !== 701) {
        useNetworkStore.getState().updatePeer(peerId, {
          error: `ICE check (${e.errorCode}): ${e.errorText || 'Address resolution pending'}`,
        });
      }
    };

    return pc;
  }

  private async pollCandidatePair(peerId: string, pc: RTCPeerConnection): Promise<void> {
    try {
      const stats = await pc.getStats();
      let activeCandidatePair: any = null;
      stats.forEach((report: any) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          activeCandidatePair = stats.get(report.selectedCandidatePairId);
        }
        if (report.type === 'candidate-pair' && (report.selected || report.state === 'succeeded')) {
          activeCandidatePair = report;
        }
      });

      if (activeCandidatePair) {
        const local = stats.get(activeCandidatePair.localCandidateId);
        const remote = stats.get(activeCandidatePair.remoteCandidateId);
        const localType = local?.candidateType || local?.type;
        const remoteType = remote?.candidateType || remote?.type;
        const localIp = local?.ip || local?.address;
        const remoteIp = remote?.ip || remote?.address;
        const pairDesc = `${localType || 'host'}${localIp ? ` (${localIp})` : ''} ↔ ${remoteType || 'host'}${remoteIp ? ` (${remoteIp})` : ''}`;
        const rttMs = activeCandidatePair.currentRoundTripTime
          ? Math.round(activeCandidatePair.currentRoundTripTime * 1000)
          : undefined;

        useNetworkStore.getState().updatePeer(peerId, {
          selectedCandidatePair: pairDesc,
          localCandidateType: localType,
          remoteCandidateType: remoteType,
          ...(rttMs !== undefined ? { rttMs } : {}),
        });
      }
    } catch {
      // Ignore stats error if pc is closing
    }
  }

  private startPeriodicStats(peerId: string, pc: RTCPeerConnection): void {
    this.stopPeriodicStats(peerId);
    const timer = setInterval(() => {
      if (pc.connectionState !== 'connected') {
        this.stopPeriodicStats(peerId);
        return;
      }
      this.pollCandidatePair(peerId, pc);
    }, 4000);
    this.statsTimers.set(peerId, timer);
  }

  private stopPeriodicStats(peerId: string): void {
    const timer = this.statsTimers.get(peerId);
    if (timer) clearInterval(timer);
    this.statsTimers.delete(peerId);
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    this.channels.set(peerId, dc);
    useNetworkStore.getState().updatePeer(peerId, { dataChannel: dc, channelStatus: 'connecting' });

    dc.onopen = () => {
      console.log(`[PeerManager] [${peerId.slice(0, 8)}] RTCDataChannel '${dc.label}' is OPEN!`);
      useNetworkStore.getState().updatePeer(peerId, {
        channelStatus: 'open',
        lastHandshake: Date.now(),
        error: null,
      });
      this.startPing(peerId, dc);
    };

    dc.onclose = () => {
      console.log(`[PeerManager] [${peerId.slice(0, 8)}] RTCDataChannel '${dc.label}' closed`);
      useNetworkStore.getState().updatePeer(peerId, { channelStatus: 'closed' });
      this.stopPing(peerId);
    };

    dc.onerror = (e) => {
      console.error(`[PeerManager] [${peerId.slice(0, 8)}] RTCDataChannel error:`, e);
      useNetworkStore.getState().updatePeer(peerId, { error: 'DataChannel error occurred' });
    };

    dc.onmessage = ({ data }) => {
      this.handleIncoming(peerId, data as ArrayBuffer);
    };
  }

  private async drainPendingIceCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const queue = this.pendingIceCandidates.get(peerId);
    if (!queue || queue.length === 0) return;
    this.pendingIceCandidates.delete(peerId);
    console.log(`[PeerManager] [${peerId.slice(0, 8)}] Applying ${queue.length} buffered ICE candidates`);
    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn(`[PeerManager] Error applying buffered candidate for ${peerId.slice(0, 8)}:`, err);
      }
    }
  }

  // ── Initiator side: create offer ────────────────────────────────────────────
  async initiateConnection(peerId: string, role: 'successor' | 'predecessor' | 'peer' = 'successor'): Promise<void> {
    console.log(`[PeerManager] Initiating connection to ${peerId.slice(0, 8)} as ${role}...`);
    const existing = this.connections.get(peerId);
    if (existing && existing.connectionState === 'connected' && this.channels.get(peerId)?.readyState === 'open') {
      console.log(`[PeerManager] Connection and DataChannel already open to ${peerId.slice(0, 8)}`);
      return;
    }

    const pc = this.createPeerConnection(peerId, role);
    const dc = pc.createDataChannel(DC_LABEL, { ordered: true });
    this.setupDataChannel(peerId, dc);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await signalingClient.sendSdpOffer(peerId, pc.localDescription!.toJSON(), this.config.sessionId);
      console.log(`[PeerManager] Sent SDP offer to ${peerId.slice(0, 8)}`);
    } catch (err: any) {
      console.error(`[PeerManager] Failed to create or send offer to ${peerId}:`, err);
      useNetworkStore.getState().updatePeer(peerId, {
        status: 'failed',
        error: `Offer creation failed: ${err.message}`,
      });
    }
  }

  // ── Responder side: answer offer ────────────────────────────────────────────
  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[PeerManager] Received SDP offer from ${peerId.slice(0, 8)}`);
    const pc = this.createPeerConnection(peerId, 'predecessor');

    pc.ondatachannel = ({ channel }) => {
      console.log(`[PeerManager] ondatachannel received '${channel.label}' from ${peerId.slice(0, 8)}`);
      this.setupDataChannel(peerId, channel);
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.drainPendingIceCandidates(peerId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await signalingClient.sendSdpAnswer(peerId, pc.localDescription!.toJSON(), this.config.sessionId);
      console.log(`[PeerManager] Sent SDP answer to ${peerId.slice(0, 8)}`);
    } catch (err: any) {
      console.error(`[PeerManager] Error handling offer from ${peerId}:`, err);
      useNetworkStore.getState().updatePeer(peerId, {
        status: 'failed',
        error: `Answer negotiation failed: ${err.message}`,
      });
    }
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[PeerManager] Received SDP answer from ${peerId.slice(0, 8)}`);
    const pc = this.connections.get(peerId);
    if (!pc) {
      console.warn(`[PeerManager] Received answer for unknown connection: ${peerId}`);
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.drainPendingIceCandidates(peerId, pc);
    } catch (err: any) {
      console.error(`[PeerManager] Error setting remote description from answer for ${peerId}:`, err);
      useNetworkStore.getState().updatePeer(peerId, {
        status: 'failed',
        error: `Remote answer failed: ${err.message}`,
      });
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.connections.get(peerId);

    // Extract remote candidate type
    if (candidate.candidate) {
      const match = candidate.candidate.match(/typ\s+([a-zA-Z0-9]+)/i);
      const typ = match ? match[1] : undefined;
      if (typ) {
        useNetworkStore.getState().updatePeer(peerId, { remoteCandidateType: typ });
      }
    }

    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      // Remote description not set yet: queue candidate
      const queue = this.pendingIceCandidates.get(peerId) || [];
      queue.push(candidate);
      this.pendingIceCandidates.set(peerId, queue);
      console.log(`[PeerManager] Buffered ICE candidate for ${peerId.slice(0, 8)} (queue size: ${queue.length})`);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e: any) {
      console.warn(`[PeerManager] addIceCandidate error for ${peerId.slice(0, 8)}:`, e.message);
    }
  }

  // ── Binary tensor protocol ──────────────────────────────────────────────────
  // Frame format (bytes):
  //   [0]   version  = 1
  //   [1]   type     = 1 (tensor) | 2 (ping) | 3 (pong) | 4 (test_tensor) | 5 (test_ack)
  //   [2-3] stageIndex (uint16 LE)
  //   [4-7] totalChunks (uint32 LE)
  //   [8-11] chunkIndex (uint32 LE)
  //   [12-15] totalBytes (uint32 LE)
  //   [16+] payload

  private static HEADER_SIZE = 16;

  sendTensor(peerId: string, stageIndex: number, tensor: Float32Array): boolean {
    const dc = this.channels.get(peerId);
    if (!dc || dc.readyState !== 'open') {
      console.warn(`[PeerManager] Cannot send tensor: DataChannel for ${peerId.slice(0, 8)} not open`);
      return false;
    }

    const payload = tensor.buffer;
    const chunkSize = 16_384; // 16 KB chunks
    const totalChunks = Math.ceil(payload.byteLength / chunkSize);
    const totalBytes = payload.byteLength;

    for (let i = 0; i < totalChunks; i++) {
      const chunkStart = i * chunkSize;
      const chunkEnd = Math.min(chunkStart + chunkSize, totalBytes);
      const chunk = payload.slice(chunkStart, chunkEnd);
      const frame = new ArrayBuffer(PeerManager.HEADER_SIZE + chunk.byteLength);
      const view = new DataView(frame);
      view.setUint8(0, 1);          // version
      view.setUint8(1, 1);          // type = tensor
      view.setUint16(2, stageIndex, true);
      view.setUint32(4, totalChunks, true);
      view.setUint32(8, i, true);
      view.setUint32(12, totalBytes, true);
      new Uint8Array(frame, PeerManager.HEADER_SIZE).set(new Uint8Array(chunk));
      dc.send(frame);
    }

    useNetworkStore.getState().addBytes('sent', totalBytes);
    useNetworkStore.getState().updatePeer(peerId, {
      bytesSent: (useNetworkStore.getState().peers[peerId]?.bytesSent ?? 0) + totalBytes,
      lastActivity: Date.now(),
    });
    return true;
  }

  // ── Test Tensor Transfer (Priority 7) ───────────────────────────────────────
  async testTensorTransfer(
    peerId: string,
    sampleValues?: Float32Array
  ): Promise<{ success: boolean; bytes: number; durationMs: number; error?: string }> {
    const dc = this.channels.get(peerId);
    if (!dc || dc.readyState !== 'open') {
      return { success: false, bytes: 0, durationMs: 0, error: 'DataChannel is not open' };
    }

    // Default 64-element test tensor with deterministic values
    const tensor = sampleValues || new Float32Array(64).map((_, i) => Math.sin(i * 0.1) * 10);
    const testId = (this.testCounter++ & 0x7FFF) || 1;
    const transferKey = `${peerId}:${testId}`;
    const payload = tensor.buffer;
    const chunkSize = 16_384;
    const totalChunks = Math.ceil(payload.byteLength / chunkSize);
    const totalBytes = payload.byteLength;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.testResolvers.delete(transferKey);
        this.testResolvers.delete(testId);
        resolve({
          success: false,
          bytes: totalBytes,
          durationMs: Date.now() - startTime,
          error: 'Timeout waiting for test tensor acknowledgment',
        });
      }, 5000);

      const resolverFn = ({ ok, bytes, error }: { ok: boolean; bytes: number; error?: string }) => {
        clearTimeout(timer);
        this.testResolvers.delete(transferKey);
        this.testResolvers.delete(testId);
        const durationMs = Date.now() - startTime;
        if (ok) {
          useNetworkStore.getState().recordTransfer({
            id: `test-${testId}-${Date.now()}`,
            fromDeviceId: this.config.myDeviceId,
            toDeviceId: peerId,
            bytes: totalBytes,
            durationMs,
            timestamp: Date.now(),
            type: 'tensor',
          });
          resolve({ success: true, bytes, durationMs });
        } else {
          resolve({ success: false, bytes, durationMs, error });
        }
      };

      this.testResolvers.set(transferKey, resolverFn);
      this.testResolvers.set(testId, resolverFn);

      for (let i = 0; i < totalChunks; i++) {
        const chunkStart = i * chunkSize;
        const chunkEnd = Math.min(chunkStart + chunkSize, totalBytes);
        const chunk = payload.slice(chunkStart, chunkEnd);
        const frame = new ArrayBuffer(PeerManager.HEADER_SIZE + chunk.byteLength);
        const view = new DataView(frame);
        view.setUint8(0, 1);       // version
        view.setUint8(1, 4);       // type = test_tensor
        view.setUint16(2, testId, true); // testId in stageIndex field
        view.setUint32(4, totalChunks, true);
        view.setUint32(8, i, true);
        view.setUint32(12, totalBytes, true);
        new Uint8Array(frame, PeerManager.HEADER_SIZE).set(new Uint8Array(chunk));
        dc.send(frame);
      }

      useNetworkStore.getState().addBytes('sent', totalBytes);
      useNetworkStore.getState().updatePeer(peerId, {
        bytesSent: (useNetworkStore.getState().peers[peerId]?.bytesSent ?? 0) + totalBytes,
        lastActivity: Date.now(),
      });
    });
  }

  private handleIncoming(peerId: string, frame: ArrayBuffer): void {
    if (frame.byteLength < PeerManager.HEADER_SIZE) return;
    const view = new DataView(frame);
    const type = view.getUint8(1);

    if (type === 2) { // ping
      if (frame.byteLength < PeerManager.HEADER_SIZE + 8) {
        console.warn(`[PeerManager] Malformed ping frame from ${peerId.slice(0, 8)}: ${frame.byteLength} bytes (expected ${PeerManager.HEADER_SIZE + 8})`);
        return;
      }
      const sentAt = view.getFloat64(PeerManager.HEADER_SIZE, true);
      this.sendPong(peerId, sentAt);
      return;
    }
    if (type === 3) { // pong
      if (frame.byteLength < PeerManager.HEADER_SIZE + 8) {
        console.warn(`[PeerManager] Malformed pong frame from ${peerId.slice(0, 8)}: ${frame.byteLength} bytes (expected ${PeerManager.HEADER_SIZE + 8})`);
        return;
      }
      const sentAt = view.getFloat64(PeerManager.HEADER_SIZE, true);
      const rttMs = Math.max(0, Date.now() - sentAt);
      useNetworkStore.getState().updatePeer(peerId, { rttMs, lastActivity: Date.now() });
      return;
    }

    if (type === 5) { // test_ack
      const testId = view.getUint16(2, true);
      const isValid = view.getUint32(4, true) === 1;
      const receivedBytes = view.getUint32(12, true);

      console.log(`[PeerManager] Received test ACK for #${testId} from ${peerId.slice(0, 8)}: valid=${isValid}, bytes=${receivedBytes}`);

      const resolver = this.testResolvers.get(`${peerId}:${testId}`) || this.testResolvers.get(testId);
      if (resolver) {
        resolver({
          ok: isValid,
          bytes: receivedBytes,
          error: isValid ? undefined : 'Tensor validation failed on receiver',
        });
      }
      return;
    }

    // type === 4 (test_tensor) or type === 1 (normal tensor)
    const stageIndexOrTestId = view.getUint16(2, true);
    const totalChunks = view.getUint32(4, true);
    const chunkIndex = view.getUint32(8, true);
    const totalBytes = view.getUint32(12, true);
    const chunkData = frame.slice(PeerManager.HEADER_SIZE);

    const isTest = (type === 4);
    const key = `${peerId}:${isTest ? 'test:' : ''}${stageIndexOrTestId}`;
    if (!this.pendingBuffers.has(key)) {
      this.pendingBuffers.set(key, new Array(totalChunks));
    }
    const chunks = this.pendingBuffers.get(key)!;
    chunks[chunkIndex] = chunkData;

    // Check if all chunks received
    if (chunks.filter(Boolean).length === totalChunks) {
      this.pendingBuffers.delete(key);
      const assembled = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        assembled.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }
      const tensor = new Float32Array(assembled.buffer);

      useNetworkStore.getState().addBytes('received', totalBytes);
      useNetworkStore.getState().updatePeer(peerId, {
        bytesReceived: (useNetworkStore.getState().peers[peerId]?.bytesReceived ?? 0) + totalBytes,
        lastActivity: Date.now(),
      });

      if (isTest) {
        // Validate tensor integrity before acknowledging
        let isValid = tensor.byteLength === totalBytes && tensor.length === (totalBytes / 4);
        for (let idx = 0; idx < Math.min(tensor.length, 16); idx++) {
          if (!Number.isFinite(tensor[idx])) {
            isValid = false;
            break;
          }
        }

        console.log(`[PeerManager] Test tensor validated: valid=${isValid}, bytes=${totalBytes}, floats=${tensor.length} from ${peerId.slice(0, 8)}`);

        // Find open DataChannel to respond on
        let targetDc = this.channels.get(peerId);
        if (!targetDc || targetDc.readyState !== 'open') {
          for (const ch of this.channels.values()) {
            if (ch.readyState === 'open') {
              targetDc = ch;
              break;
            }
          }
        }

        if (targetDc && targetDc.readyState === 'open') {
          const ackFrame = new ArrayBuffer(PeerManager.HEADER_SIZE);
          const ackView = new DataView(ackFrame);
          ackView.setUint8(0, 1);
          ackView.setUint8(1, 5); // type = test_ack
          ackView.setUint16(2, stageIndexOrTestId, true);
          ackView.setUint32(4, isValid ? 1 : 0, true);
          ackView.setUint32(8, tensor.length, true);
          ackView.setUint32(12, totalBytes, true);
          try {
            targetDc.send(ackFrame);
            console.log(`[PeerManager] Dispatched test ACK #${stageIndexOrTestId} to ${peerId.slice(0, 8)}`);
          } catch (err) {
            console.error('[PeerManager] Failed to send test ACK:', err);
          }
        }
      } else {
        this.config.onTensorReceived(stageIndexOrTestId, tensor);
        this.tensorListeners.forEach(listener => {
          try {
            listener(stageIndexOrTestId, tensor);
          } catch (e) {
            console.error('[PeerManager] tensorListener error:', e);
          }
        });
      }
    }
  }

  private startPing(peerId: string, dc: RTCDataChannel): void {
    this.stopPing(peerId);
    const timer = setInterval(() => {
      if (dc.readyState !== 'open') return;
      const frame = new ArrayBuffer(PeerManager.HEADER_SIZE + 8);
      const view = new DataView(frame);
      view.setUint8(0, 1);   // version
      view.setUint8(1, 2);   // type = ping
      view.setFloat64(PeerManager.HEADER_SIZE, Date.now(), true);
      try {
        dc.send(frame);
      } catch {
        // ignore send error on closing dc
      }
    }, 4000);
    this.pingTimers.set(peerId, timer);
  }

  private sendPong(peerId: string, sentAt: number): void {
    let dc = this.channels.get(peerId);
    if (!dc || dc.readyState !== 'open') {
      for (const ch of this.channels.values()) {
        if (ch.readyState === 'open') {
          dc = ch;
          break;
        }
      }
    }
    if (!dc || dc.readyState !== 'open') return;
    const frame = new ArrayBuffer(PeerManager.HEADER_SIZE + 8);
    const view = new DataView(frame);
    view.setUint8(0, 1);   // version
    view.setUint8(1, 3);   // type = pong
    view.setFloat64(PeerManager.HEADER_SIZE, sentAt, true);
    try {
      dc.send(frame);
    } catch {
      // ignore
    }
  }

  private stopPing(peerId: string): void {
    const timer = this.pingTimers.get(peerId);
    if (timer) clearInterval(timer);
    this.pingTimers.delete(peerId);
  }

  private cleanupPeer(peerId: string, removeFromStore = true): void {
    this.stopPing(peerId);
    this.stopPeriodicStats(peerId);
    this.channels.get(peerId)?.close();
    this.channels.delete(peerId);
    this.connections.get(peerId)?.close();
    this.connections.delete(peerId);
    this.pendingIceCandidates.delete(peerId);
    if (removeFromStore) {
      useNetworkStore.getState().removePeer(peerId);
    }
  }

  private registerSignalingHandlers(): void {
    const u1 = signalingClient.on<{ from: string; sdp: RTCSessionDescriptionInit }>('sdpOffer', async ({ from, sdp }) => {
      await this.handleOffer(from, sdp);
    });
    const u2 = signalingClient.on<{ from: string; sdp: RTCSessionDescriptionInit }>('sdpAnswer', async ({ from, sdp }) => {
      await this.handleAnswer(from, sdp);
    });
    const u3 = signalingClient.on<{ from: string; candidate: RTCIceCandidateInit }>('iceCandidate', async ({ from, candidate }) => {
      await this.handleIceCandidate(from, candidate);
    });
    this.unsubs.push(u1, u2, u3);
  }

  dispose(): void {
    this.unsubs.forEach(fn => fn());
    this.unsubs = [];
    for (const peerId of this.connections.keys()) {
      this.cleanupPeer(peerId);
    }
  }
}

// ── Singleton Accessors ───────────────────────────────────────────────────────
let activePeerManager: PeerManager | null = null;

export function getPeerManager(): PeerManager | null {
  return activePeerManager;
}

export function initPeerManager(config: PeerManagerConfig): PeerManager {
  if (activePeerManager) {
    const cur = activePeerManager.getConfig();
    if (cur.sessionId === config.sessionId && cur.myDeviceId === config.myDeviceId) {
      return activePeerManager;
    }
    activePeerManager.dispose();
  }
  activePeerManager = new PeerManager(config);
  return activePeerManager;
}

export function disposePeerManager(): void {
  if (activePeerManager) {
    activePeerManager.dispose();
    activePeerManager = null;
  }
}
