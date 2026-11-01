// src/hooks/usePipelineCoordinator.ts
import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/useSessionStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { signalingClient } from '../services/SignalingClient';
import { initPeerManager, getPeerManager, disposePeerManager } from '../services/PeerManager';

export function usePipelineCoordinator() {
  const session = useSessionStore();
  const settings = useSettingsStore();
  const network = useNetworkStore();
  const connectingPeers = useRef<Set<string>>(new Set());

  // 1. Maintain active PeerManager lifecycle while session is active
  useEffect(() => {
    if (!session.sessionId || !session.myDeviceId) {
      disposePeerManager();
      connectingPeers.current.clear();
      return;
    }

    const pm = initPeerManager({
      sessionId: session.sessionId,
      myDeviceId: session.myDeviceId,
      stunUrls: settings.stunUrls,
      turnUrl: settings.turnUrl || undefined,
      turnUsername: settings.turnUsername || undefined,
      turnCredential: settings.turnCredential || undefined,
      onTensorReceived: (stageIndex, tensor) => {
        console.log(`[PipelineCoordinator] Tensor received for stage ${stageIndex}: ${tensor.byteLength} bytes`);
      },
    });

    if (typeof window !== 'undefined') {
      (window as any).__peerManager = pm;
      (window as any).__useNetworkStore = useNetworkStore;
      (window as any).__useSessionStore = useSessionStore;
    }

    return () => {
      // Keep alive during route transitions within same session
    };
  }, [session.sessionId, session.myDeviceId, settings.stunUrls, settings.turnUrl, settings.turnUsername, settings.turnCredential]);

  // 2. Global signaling listeners for session membership and stage synchronization
  useEffect(() => {
    if (!session.sessionId) return;

    const unsubs = [
      signalingClient.on<{ peerId: string; deviceCount: number; device?: any; devices?: any[] }>(
        'peerJoined',
        ({ peerId, deviceCount, device, devices }) => {
          console.log(`[PipelineCoordinator] peerJoined: ${peerId.slice(0, 8)} (count: ${deviceCount})`);
          if (devices && Array.isArray(devices)) {
            session.setDevices(devices.map((d: any) => ({
              deviceId: d.deviceId,
              socketId: d.socketId,
              capabilities: d.capabilities,
              stageIndex: d.stageIndex,
            })));
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
        console.log(`[PipelineCoordinator] peerLeft: ${peerId.slice(0, 8)}`);
        session.removeDevice(peerId);
      }),
      signalingClient.on<{ assignments: Array<{ deviceId: string; stageIndex: number; totalDevices: number }> }>(
        'stageAssignment',
        ({ assignments }) => {
          console.log(`[PipelineCoordinator] stageAssignment across ${assignments.length} devices`);
          session.setStageAssignments(assignments);
        }
      ),
      signalingClient.on<{ deviceId: string; caps: any; stageIndex: number }>(
        'capsUpdate',
        ({ deviceId, caps, stageIndex }) => {
          session.updateDevice(deviceId, { capabilities: caps, stageIndex });
        }
      ),
    ];

    return () => unsubs.forEach(fn => fn());
  }, [session.sessionId]);

  // 3. Automate deterministic adjacent pipeline negotiation: Stage k connects to Stage k + 1
  useEffect(() => {
    const { sessionId, myDeviceId, myStageIndex, devices } = session;
    if (!sessionId || !myDeviceId || devices.length < 2) return;

    const pm = getPeerManager();
    if (!pm) return;

    // Find immediate successor in pipeline (Stage k + 1)
    const successor = devices.find(d => d.stageIndex === myStageIndex + 1);

    if (successor) {
      const existingPeer = network.peers[successor.deviceId];
      const isAlreadyConnected = existingPeer?.status === 'connected' && existingPeer?.channelStatus === 'open';
      const pc = pm.getConnection(successor.deviceId);
      const isPcActive = pc && (pc.connectionState === 'connecting' || pc.connectionState === 'connected');
      const isConnecting = existingPeer?.status === 'connecting' || isPcActive || connectingPeers.current.has(successor.deviceId);

      if (isAlreadyConnected || existingPeer?.status === 'failed') {
        connectingPeers.current.delete(successor.deviceId);
      }

      if (!isAlreadyConnected && !isConnecting) {
        console.log(`[PipelineCoordinator] Auto-connecting pipeline: Stage ${myStageIndex} (${myDeviceId.slice(0, 6)}) -> Stage ${successor.stageIndex} (${successor.deviceId.slice(0, 6)})`);
        connectingPeers.current.add(successor.deviceId);

        pm.initiateConnection(successor.deviceId, 'successor')
          .catch((err) => {
            console.error(`[PipelineCoordinator] Pipeline connection failed to ${successor.deviceId}:`, err);
            connectingPeers.current.delete(successor.deviceId);
          });
      }
    }
  }, [session.sessionId, session.myDeviceId, session.myStageIndex, session.devices, network.peers]);
}
