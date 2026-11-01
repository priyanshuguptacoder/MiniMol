// src/stores/useHistoryStore.ts
import { create } from 'zustand';

export interface HistoryRecord {
  id: string;
  sessionId: string;
  prompt: string;
  output: string;
  deviceCount: number;
  totalMs: number;
  tokenCount: number;
  bytesTransferred: number;
  createdAt: number;
}

export interface HistoryState {
  records: HistoryRecord[];
}

export interface HistoryActions {
  addRecord: (r: HistoryRecord) => void;
  deleteRecord: (id: string) => void;
  clearAll: () => void;
  loadFromStorage: () => void;
}

const STORAGE_KEY = 'splitinfer_history';

function loadRecords(): HistoryRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecords(records: HistoryRecord[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-100)));
  } catch {
    // storage full – ignore
  }
}

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  records: [],

  addRecord: (r) => {
    const records = [r, ...get().records].slice(0, 100);
    set({ records });
    saveRecords(records);
  },

  deleteRecord: (id) => {
    const records = get().records.filter(r => r.id !== id);
    set({ records });
    saveRecords(records);
  },

  clearAll: () => {
    set({ records: [] });
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  },

  loadFromStorage: () => set({ records: loadRecords() }),
}));
