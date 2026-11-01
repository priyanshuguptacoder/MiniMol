// src/stores/useNetworkStore.ts
import { create } from 'zustand';

export type PeerStatus = 'connecting' | 'connected' | 'failed' | 'closed';
export type ChannelStatus = 'connecting' | 'open' | 'closed';

export interface PeerEntry {
  peerId: string;
  connection: RTCPeerConnection | null;
  status: PeerStatus;
  iceState?: RTCIceConnectionState;
  connectionState?: RTCPeerConnectionState;
  signalingState?: RTCSignalingState;
  iceGatheringState?: RTCIceGatheringState;
  rttMs: number | null;
  dataChannel: RTCDataChannel | null;
  channelStatus: ChannelStatus;
  bytesReceived: number;
  bytesSent: number;
  lastActivity: number;
  lastHandshake?: number | null;
  localCandidateType?: string;
  remoteCandidateType?: string;
  selectedCandidatePair?: string;
  targetStage?: number;
  role?: 'predecessor' | 'successor' | 'coordinator' | 'peer';
  error?: string | null;
}

export interface TransferEvent {
  id: string;
  fromDeviceId: string;
  toDeviceId: string;
  bytes: number;
  durationMs: number;
  timestamp: number;
  type: 'tensor' | 'control';
}

export interface NetworkState {
  peers: Record<string, PeerEntry>;
  transfers: TransferEvent[];
  totalBytesSent: number;
  totalBytesReceived: number;
}

export interface NetworkActions {
  addPeer: (peerId: string) => void;
  updatePeer: (peerId: string, partial: Partial<PeerEntry>) => void;
  removePeer: (peerId: string) => void;
  recordTransfer: (t: TransferEvent) => void;
  addBytes: (direction: 'sent' | 'received', bytes: number) => void;
  reset: () => void;
}

const initial: NetworkState = {
  peers: {},
  transfers: [],
  totalBytesSent: 0,
  totalBytesReceived: 0,
};

export const useNetworkStore = create<NetworkState & NetworkActions>((set) => ({
  ...initial,

  addPeer: (peerId) => set(s => ({
    peers: {
      ...s.peers,
      [peerId]: {
        peerId,
        connection: null,
        status: 'connecting',
        iceState: 'new',
        connectionState: 'new',
        signalingState: 'stable',
        iceGatheringState: 'new',
        rttMs: null,
        dataChannel: null,
        channelStatus: 'connecting',
        bytesReceived: 0,
        bytesSent: 0,
        lastActivity: Date.now(),
        lastHandshake: null,
        error: null,
      },
    },
  })),

  updatePeer: (peerId, partial) => set(s => ({
    peers: s.peers[peerId]
      ? { ...s.peers, [peerId]: { ...s.peers[peerId], ...partial } }
      : s.peers,
  })),

  removePeer: (peerId) => set(s => {
    const peers = { ...s.peers };
    delete peers[peerId];
    return { peers };
  }),

  recordTransfer: (t) => set(s => ({
    transfers: [...s.transfers.slice(-99), t], // keep last 100
  })),

  addBytes: (direction, bytes) => set(s =>
    direction === 'sent'
      ? { totalBytesSent: s.totalBytesSent + bytes }
      : { totalBytesReceived: s.totalBytesReceived + bytes }
  ),

  reset: () => set(initial),
}));
