// src/stores/useModelStore.ts
import { create } from 'zustand';

export interface StageManifest {
  stageIndex: number;
  file: string;
  inputName: string;
  outputName: string;
  inputShape: number[];
  outputShape: number[];
  sha256: string;
}

export interface ModelManifest {
  modelName: string;
  vocabSize: number;
  hiddenDim: number;
  numHeads: number;
  contextLen: number;
  numLayers: number;
  stages: StageManifest[];
  vocab: Record<string, number>;
  vocabInv: Record<number, string>;
  createdAt: string;
}

export type ModelLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelState {
  manifest: ModelManifest | null;
  loadStatus: ModelLoadStatus;
  loadError: string | null;
  myStageLoaded: boolean;
  manifestUrl: string;
}

export interface ModelActions {
  setManifest: (m: ModelManifest) => void;
  setLoadStatus: (loadStatus: ModelLoadStatus, loadError?: string) => void;
  setMyStageLoaded: (v: boolean) => void;
  setManifestUrl: (url: string) => void;
  reset: () => void;
}

const initial: ModelState = {
  manifest: null,
  loadStatus: 'idle',
  loadError: null,
  myStageLoaded: false,
  manifestUrl: '/models/manifest.json',
};

export const useModelStore = create<ModelState & ModelActions>((set) => ({
  ...initial,
  setManifest: (manifest) => set({ manifest }),
  setLoadStatus: (loadStatus, loadError = undefined) => set({ loadStatus, loadError: loadError ?? null }),
  setMyStageLoaded: (myStageLoaded) => set({ myStageLoaded }),
  setManifestUrl: (manifestUrl) => set({ manifestUrl }),
  reset: () => set(initial),
}));
