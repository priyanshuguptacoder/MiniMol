// src/stores/useInferenceStore.ts
import { create } from 'zustand';

export type InferenceStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error';

export interface StageLog {
  stageIndex: number;
  deviceId: string;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
  bytesTransferred: number;
}

export interface InferenceRun {
  id: string;
  prompt: string;
  output: string;
  tokenCount: number;
  totalMs: number | null;
  stageLogs: StageLog[];
  status: InferenceStatus;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface InferenceState {
  currentRun: InferenceRun | null;
  outputTokens: string[];
  status: InferenceStatus;
  logs: string[];
  temperature: number;
  maxTokens: number;
}

export interface InferenceActions {
  startRun: (prompt: string) => void;
  appendToken: (token: string) => void;
  appendLog: (msg: string) => void;
  updateStageLog: (stageIndex: number, partial: Partial<StageLog>) => void;
  completeRun: (output: string, metrics: { totalMs: number }) => void;
  cancelRun: () => void;
  setError: (err: string) => void;
  setTemperature: (t: number) => void;
  setMaxTokens: (n: number) => void;
  reset: () => void;
}

const initial: InferenceState = {
  currentRun: null,
  outputTokens: [],
  status: 'idle',
  logs: [],
  temperature: 0.8,
  maxTokens: 64,
};

export const useInferenceStore = create<InferenceState & InferenceActions>((set) => ({
  ...initial,

  startRun: (prompt) => set({
    status: 'running',
    outputTokens: [],
    logs: [`[${new Date().toISOString()}] Starting inference for prompt: "${prompt.slice(0, 40)}..."`],
    currentRun: {
      id: crypto.randomUUID(),
      prompt,
      output: '',
      tokenCount: 0,
      totalMs: null,
      stageLogs: [],
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    },
  }),

  appendToken: (token) => set(s => ({
    outputTokens: [...s.outputTokens, token],
    currentRun: s.currentRun
      ? { ...s.currentRun, output: s.currentRun.output + token, tokenCount: s.currentRun.tokenCount + 1 }
      : null,
  })),

  appendLog: (msg) => set(s => ({
    logs: [...s.logs.slice(-199), `[${new Date().toISOString()}] ${msg}`],
  })),

  updateStageLog: (stageIndex, partial) => set(s => {
    if (!s.currentRun) return s;
    const existing = s.currentRun.stageLogs.find(sl => sl.stageIndex === stageIndex);
    const stageLogs = existing
      ? s.currentRun.stageLogs.map(sl => sl.stageIndex === stageIndex ? { ...sl, ...partial } : sl)
      : [...s.currentRun.stageLogs, { stageIndex, deviceId: '', startMs: Date.now(), endMs: null, durationMs: null, bytesTransferred: 0, ...partial }];
    return { currentRun: { ...s.currentRun, stageLogs } };
  }),

  completeRun: (output, { totalMs }) => set(s => ({
    status: 'completed',
    currentRun: s.currentRun
      ? { ...s.currentRun, output, totalMs, status: 'completed', completedAt: Date.now() }
      : null,
  })),

  cancelRun: () => set(s => ({
    status: 'cancelled',
    currentRun: s.currentRun
      ? { ...s.currentRun, status: 'cancelled', completedAt: Date.now() }
      : null,
  })),

  setError: (err) => set(s => ({
    status: 'error',
    currentRun: s.currentRun
      ? { ...s.currentRun, status: 'error', error: err, completedAt: Date.now() }
      : null,
    logs: [...s.logs.slice(-199), `[ERROR] ${err}`],
  })),

  setTemperature: (temperature) => set({ temperature }),
  setMaxTokens: (maxTokens) => set({ maxTokens }),
  reset: () => set(initial),
}));
