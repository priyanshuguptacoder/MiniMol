// apps/web/src/tests/signaling.test.ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';

// In-memory mock of the signaling state manager and event router
class MockSignalingCoordinator {
  private sessions = new Map<string, { id: string; hostId: string; devices: Map<string, { stageIndex: number; caps: any }> }>();
  private sockets = new Map<string, EventEmitter>();

  createSocket(id: string): EventEmitter {
    const emitter = new EventEmitter();
    this.sockets.set(id, emitter);
    return emitter;
  }

  createSession(socketId: string, maxDevices = 4): string {
    const sessionId = 'SI-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const session = {
      id: sessionId,
      hostId: socketId,
      devices: new Map([[socketId, { stageIndex: 0, caps: null }]]),
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  joinSession(socketId: string, sessionId: string): { ok: boolean; stageIndex?: number; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    const stageIndex = session.devices.size;
    session.devices.set(socketId, { stageIndex, caps: null });

    // Notify other peers in room
    for (const [peerId] of session.devices) {
      if (peerId !== socketId) {
        this.sockets.get(peerId)?.emit('peerJoined', { peerId: socketId, stageIndex });
      }
    }
    return { ok: true, stageIndex };
  }

  updateCaps(socketId: string, sessionId: string, caps: any) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.devices.has(socketId)) return;
    session.devices.get(socketId)!.caps = caps;

    for (const [peerId] of session.devices) {
      this.sockets.get(peerId)?.emit('capsUpdate', { deviceId: socketId, caps });
    }
  }

  relaySdp(fromId: string, toId: string, sdp: any) {
    this.sockets.get(toId)?.emit('sdp', { from: fromId, sdp });
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }
}

describe('Signaling Server Session & WebRTC Negotiation Logic', () => {
  it('manages room creation, joining, and peer capability broadcasting', () => {
    const coordinator = new MockSignalingCoordinator();
    const host = coordinator.createSocket('host-laptop');
    const phone1 = coordinator.createSocket('phone-1');

    // 1. Host creates session
    const sessionId = coordinator.createSession('host-laptop', 4);
    expect(sessionId).toMatch(/^SI-[A-Z0-9]{4}$/);

    // 2. Phone 1 joins
    let peerJoinedEvent: any = null;
    host.on('peerJoined', (data) => {
      peerJoinedEvent = data;
    });

    const joinRes = coordinator.joinSession('phone-1', sessionId);
    expect(joinRes.ok).toBe(true);
    expect(joinRes.stageIndex).toBe(1);
    expect(peerJoinedEvent).toEqual({ peerId: 'phone-1', stageIndex: 1 });

    // 3. Capabilities broadcast
    let capsReceived: any = null;
    host.on('capsUpdate', (data) => {
      capsReceived = data;
    });

    coordinator.updateCaps('phone-1', sessionId, { cpuCores: 8, platform: 'Android' });
    expect(capsReceived).toEqual({
      deviceId: 'phone-1',
      caps: { cpuCores: 8, platform: 'Android' },
    });

    // 4. SDP Relay
    let sdpReceived: any = null;
    phone1.on('sdp', (data) => {
      sdpReceived = data;
    });

    coordinator.relaySdp('host-laptop', 'phone-1', { type: 'offer', sdp: 'v=0...' });
    expect(sdpReceived).toEqual({
      from: 'host-laptop',
      sdp: { type: 'offer', sdp: 'v=0...' },
    });
  });
});
