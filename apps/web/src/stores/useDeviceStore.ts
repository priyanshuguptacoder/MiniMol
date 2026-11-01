// src/stores/useDeviceStore.ts
import { create } from 'zustand';
import type { DeviceCapabilities } from './useSessionStore';

export interface DeviceState {
  myCapabilities: DeviceCapabilities | null;
}

export interface DeviceActions {
  discoverCapabilities: () => DeviceCapabilities;
}

function getEstimatedMemoryGb(): number {
  // navigator.deviceMemory is non-standard but widely supported
  const nav = navigator as Navigator & { deviceMemory?: number };
  return nav.deviceMemory ?? 4;
}

function detectWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export const useDeviceStore = create<DeviceState & DeviceActions>((set) => ({
  myCapabilities: null,

  discoverCapabilities: () => {
    const caps: DeviceCapabilities = {
      cpuCores: navigator.hardwareConcurrency || 1,
      platform: navigator.platform || 'unknown',
      userAgent: navigator.userAgent.slice(0, 200),
      estimatedMemoryGb: getEstimatedMemoryGb(),
      supportsWasm: typeof WebAssembly !== 'undefined',
      supportsWebGpu: detectWebGpu(),
    };
    set({ myCapabilities: caps });
    return caps;
  },
}));
