import { create } from 'zustand';
import type { MetricSnapshot } from '../types';

interface MetricsState {
  snapshots: MetricSnapshot[];
  latestSnapshot: MetricSnapshot | null;

  pushSnapshot: (snapshot: MetricSnapshot) => void;
  reset: () => void;
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  snapshots: [],
  latestSnapshot: null,

  pushSnapshot: (snapshot) => {
    // Mutate the array in place and bump reference only for latestSnapshot.
    // Dashboard reads snapshots via getState() in useMemo; the latestSnapshot
    // change triggers the re-render that causes useMemo to re-evaluate.
    get().snapshots.push(snapshot);
    set({ latestSnapshot: snapshot });
  },

  reset: () => set({ snapshots: [], latestSnapshot: null }),
}));
