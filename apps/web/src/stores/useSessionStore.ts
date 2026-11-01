// src/stores/useSessionStore.ts
import { create } from 'zustand';

export type SessionStatus = 'idle' | 'creating' | 'waiting' | 'active' | 'ended' | 'error';

export interface DeviceInfo {
  deviceId: string;
  socketId: string;
  capabilities: DeviceCapabilities | null;
  stageIndex: number;
}

export interface DeviceCapabilities {
  cpuCores: number;
  platform: string;
  userAgent: string;
  estimatedMemoryGb: number;
  supportsWasm: boolean;
  supportsWebGpu: boolean;
}

export interface SessionState {
  sessionId: string | null;
  myDeviceId: string | null;
  myStageIndex: number;
  totalDevices: number;
  hostId: string | null;
  isHost: boolean;
  devices: DeviceInfo[];
  status: SessionStatus;
  error: string | null;
}

export interface SessionActions {
  setSession: (s: Partial<SessionState>) => void;
  addDevice: (d: DeviceInfo) => void;
  setDevices: (devices: DeviceInfo[]) => void;
  removeDevice: (deviceId: string) => void;
  updateDevice: (deviceId: string, partial: Partial<DeviceInfo>) => void;
  setStatus: (status: SessionStatus) => void;
  setError: (err: string | null) => void;
  setStageAssignments: (assignments: Array<{ deviceId: string; stageIndex: number; totalDevices: number }>) => void;
  reset: () => void;
}

const initial: SessionState = {
  sessionId: null,
  myDeviceId: null,
  myStageIndex: 0,
  totalDevices: 0,
  hostId: null,
  isHost: false,
  devices: [],
  status: 'idle',
  error: null,
};

export const useSessionStore = create<SessionState & SessionActions>((set, get) => ({
  ...initial,

  setSession: (partial) => set(s => ({ ...s, ...partial })),

  addDevice: (d) => set(s => {
    const exists = s.devices.find(x => x.deviceId === d.deviceId);
    if (exists) {
      return {
        devices: s.devices.map(x => x.deviceId === d.deviceId ? { ...x, ...d } : x),
      };
    }
    return { devices: [...s.devices, d], totalDevices: s.devices.length + 1 };
  }),

  setDevices: (devices) => set({ devices, totalDevices: devices.length }),

  removeDevice: (deviceId) => set(s => ({
    devices: s.devices.filter(d => d.deviceId !== deviceId),
    totalDevices: Math.max(0, s.totalDevices - 1),
  })),

  updateDevice: (deviceId, partial) => set(s => ({
    devices: s.devices.map(d => d.deviceId === deviceId ? { ...d, ...partial } : d),
  })),

  setStatus: (status) => set({ status }),

  setError: (error) => set({ error, status: error ? 'error' : get().status }),

  setStageAssignments: (assignments) => set(s => {
    const myAssignment = assignments.find(a => a.deviceId === s.myDeviceId);
    const devices = s.devices.map(d => {
      const a = assignments.find(x => x.deviceId === d.deviceId);
      return a ? { ...d, stageIndex: a.stageIndex } : d;
    });
    return {
      devices,
      myStageIndex: myAssignment?.stageIndex ?? s.myStageIndex,
      totalDevices: assignments[0]?.totalDevices ?? s.totalDevices,
    };
  }),

  reset: () => set(initial),
}));
