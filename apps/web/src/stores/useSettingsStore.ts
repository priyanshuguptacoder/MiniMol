// src/stores/useSettingsStore.ts
import { create } from 'zustand';

export interface SettingsState {
  signalingUrl: string;
  stunUrls: string[];
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
  maxDevices: number;
  inferenceBackend: 'wasm' | 'webgpu';
  manifestUrl: string;
  enableHeartbeat: boolean;
  heartbeatIntervalMs: number;
  storeHistory: boolean;
}

export interface SettingsActions {
  update: (partial: Partial<SettingsState>) => void;
  save: () => void;
  load: () => void;
  reset: () => void;
}

const STORAGE_KEY = 'splitinfer_settings';

export function getDefaultSignalingUrl(): string {
  // 1. Explicit env var override
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SIGNALING_URL) {
    return (import.meta as any).env.VITE_SIGNALING_URL;
  }
  // 2. Dynamic derivation from window.location (preserves mobile LAN IP)
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:4000`;
  }
  return 'http://localhost:4000';
}

function getInitialDefaults(): SettingsState {
  const envStun = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STUN_URLS)
    ? (import.meta as any).env.VITE_STUN_URLS.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
      ];

  const envTurnUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TURN_URL) || '';
  const envTurnUsername = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TURN_USERNAME) || '';
  const envTurnCredential = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TURN_CREDENTIAL) || '';

  return {
    signalingUrl: getDefaultSignalingUrl(),
    stunUrls: envStun,
    turnUrl: envTurnUrl,
    turnUsername: envTurnUsername,
    turnCredential: envTurnCredential,
    maxDevices: 4,
    inferenceBackend: 'wasm',
    manifestUrl: '/models/manifest.json',
    enableHeartbeat: true,
    heartbeatIntervalMs: 10000,
    storeHistory: true,
  };
}

function loadSettings(): SettingsState {
  const defaults = getInitialDefaults();
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const loaded = { ...defaults, ...parsed };

    // If loaded URL has 'localhost' but current device is on LAN IP, use LAN IP
    if (
      typeof window !== 'undefined' &&
      window.location &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1' &&
      loaded.signalingUrl.includes('localhost')
    ) {
      loaded.signalingUrl = getDefaultSignalingUrl();
    }
    return loaded;
  } catch {
    return defaults;
  }
}

export const useSettingsStore = create<SettingsState & SettingsActions>((set, get) => ({
  ...loadSettings(),

  update: (partial) => set(s => ({ ...s, ...partial })),

  save: () => {
    const { update: _u, save: _s, load: _l, reset: _r, ...state } = get() as SettingsState & SettingsActions;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch {}
  },

  load: () => set({ ...loadSettings() }),

  reset: () => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    set(getInitialDefaults());
  },
}));
