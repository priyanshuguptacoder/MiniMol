// apps/web/src/tests/stores.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../stores/useSessionStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { useInferenceStore } from '../stores/useInferenceStore';
import { useHistoryStore } from '../stores/useHistoryStore';

describe('Zustand State Stores', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
    useNetworkStore.getState().reset();
    useInferenceStore.getState().reset();
    useHistoryStore.getState().clearAll();
  });

  it('manages session lifecycle and stage assignments', () => {
    const store = useSessionStore.getState();
    store.setSession({
      sessionId: 'SI-TEST01',
      myDeviceId: 'dev-1',
      hostId: 'dev-1',
      isHost: true,
      status: 'waiting',
    });

    store.addDevice({
      deviceId: 'dev-1',
      socketId: 'dev-1',
      capabilities: null,
      stageIndex: 0,
    });
    store.addDevice({
      deviceId: 'dev-2',
      socketId: 'dev-2',
      capabilities: null,
      stageIndex: 1,
    });

    const s = useSessionStore.getState();
    expect(s.devices.length).toBe(2);
    expect(s.totalDevices).toBe(2);

    store.setStageAssignments([
      { deviceId: 'dev-1', stageIndex: 0, totalDevices: 2 },
      { deviceId: 'dev-2', stageIndex: 1, totalDevices: 2 },
    ]);

    const assigned = useSessionStore.getState();
    expect(assigned.myStageIndex).toBe(0);
  });

  it('tracks peer network byte statistics and transfer events', () => {
    const store = useNetworkStore.getState();
    store.addPeer('peer-node-1');
    store.updatePeer('peer-node-1', { status: 'connected', rttMs: 24 });

    const s1 = useNetworkStore.getState();
    expect(s1.peers['peer-node-1'].status).toBe('connected');
    expect(s1.peers['peer-node-1'].rttMs).toBe(24);

    store.addBytes('sent', 16384);
    store.addBytes('received', 8192);

    const s2 = useNetworkStore.getState();
    expect(s2.totalBytesSent).toBe(16384);
    expect(s2.totalBytesReceived).toBe(8192);
  });

  it('manages autoregressive token streaming in inferenceStore', () => {
    const store = useInferenceStore.getState();
    store.startRun('Once upon a time');

    store.appendToken(' there');
    store.appendToken(' was');
    store.appendToken(' light');

    const s = useInferenceStore.getState();
    expect(s.status).toBe('running');
    expect(s.outputTokens).toEqual([' there', ' was', ' light']);
    expect(s.currentRun?.output).toBe(' there was light');
    expect(s.currentRun?.tokenCount).toBe(3);

    store.completeRun(' there was light', { totalMs: 125 });
    const sDone = useInferenceStore.getState();
    expect(sDone.status).toBe('completed');
    expect(sDone.currentRun?.totalMs).toBe(125);
  });
});
