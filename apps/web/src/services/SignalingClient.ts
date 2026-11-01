// src/services/SignalingClient.ts
// WebSocket/Socket.IO signaling client
import { io, Socket } from 'socket.io-client';
import type { DeviceCapabilities } from '../stores/useSessionStore';

export type SigEvent =
  | 'peerJoined'
  | 'peerLeft'
  | 'hostChanged'
  | 'capsUpdate'
  | 'stageAssignment'
  | 'sdpOffer'
  | 'sdpAnswer'
  | 'iceCandidate'
  | 'inferenceStart'
  | 'inferenceResult';

type ListenerMap = {
  [K in SigEvent]: ((data: unknown) => void)[];
};

export class SignalingClient {
  private socket: Socket | null = null;
  private listeners: ListenerMap = {
    peerJoined: [],
    peerLeft: [],
    hostChanged: [],
    capsUpdate: [],
    stageAssignment: [],
    sdpOffer: [],
    sdpAnswer: [],
    iceCandidate: [],
    inferenceStart: [],
    inferenceResult: [],
  };
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10_000,
      });

      this.socket.once('connect', () => resolve());
      this.socket.once('connect_error', reject);

      // Forward all signaling events
      for (const event of Object.keys(this.listeners) as SigEvent[]) {
        this.socket.on(event, (data: unknown) => {
          this.listeners[event].forEach(fn => fn(data));
        });
      }
    });
  }

  on<T = unknown>(event: SigEvent, fn: (data: T) => void): () => void {
    (this.listeners[event] as ((data: unknown) => void)[]).push(fn as (data: unknown) => void);
    return () => {
      this.listeners[event] = this.listeners[event].filter(f => f !== fn as unknown) as ((data: unknown) => void)[];
    };
  }

  createSession(maxDevices = 4): Promise<{ sessionId: string; deviceId: string }> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      this.socket.emit('createSession', { maxDevices }, (res: { sessionId?: string; deviceId?: string; error?: string }) => {
        if (res.error) return reject(new Error(res.error));
        resolve({ sessionId: res.sessionId!, deviceId: res.deviceId! });
      });
    });
  }

  joinSession(sessionId: string): Promise<{ deviceId: string; stageIndex: number; session?: any }> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      this.socket.emit('joinSession', { sessionId }, (res: { ok?: boolean; deviceId?: string; stageIndex?: number; session?: any; error?: string }) => {
        if (res.error) return reject(new Error(res.error));
        resolve({ deviceId: res.deviceId!, stageIndex: res.stageIndex!, session: res.session });
      });
    });
  }

  getSession(sessionId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      this.socket.emit('getSession', { sessionId }, (res: { session?: any; error?: string }) => {
        if (res?.error) return reject(new Error(res.error));
        resolve(res?.session);
      });
    });
  }

  sendCapabilities(sessionId: string, caps: DeviceCapabilities): void {
    this.socket?.emit('capabilities', { sessionId, caps });
  }

  sendSdpOffer(to: string, sdp: RTCSessionDescriptionInit, sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      this.socket?.emit('sdpOffer', { to, sdp, sessionId }, (res: { ok?: boolean; error?: string }) => {
        if (res?.error) console.warn('[SignalingClient] sendSdpOffer warning:', res.error);
        resolve();
      });
    });
  }

  sendSdpAnswer(to: string, sdp: RTCSessionDescriptionInit, sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      this.socket?.emit('sdpAnswer', { to, sdp, sessionId }, (res: { ok?: boolean; error?: string }) => {
        if (res?.error) console.warn('[SignalingClient] sendSdpAnswer warning:', res.error);
        resolve();
      });
    });
  }

  sendIceCandidate(to: string, candidate: RTCIceCandidateInit, sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      this.socket?.emit('iceCandidate', { to, candidate, sessionId }, (res: { ok?: boolean; error?: string }) => {
        if (res?.error) console.warn('[SignalingClient] sendIceCandidate warning:', res.error);
        resolve();
      });
    });
  }

  startHeartbeat(intervalMs = 10_000): void {
    this.heartbeatTimer = setInterval(() => {
      this.socket?.emit('heartbeat', {}, (res: { pong?: number }) => {
        if (res?.pong) {
          // Could use this to measure server RTT
        }
      });
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  startInference(sessionId: string, prompt: string): void {
    this.socket?.emit('startInference', { sessionId, prompt });
  }

  reportInferenceComplete(sessionId: string, result: string, metrics: object): void {
    this.socket?.emit('inferenceComplete', { sessionId, result, metrics });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.socket?.disconnect();
    this.socket = null;
  }

  get socketId(): string | null {
    return this.socket?.id ?? null;
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

// Singleton instance
export const signalingClient = new SignalingClient();
