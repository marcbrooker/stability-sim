import { create } from 'zustand';
import type { MetricSelection } from '../types';

interface UIStoreState {
  selectedComponentId: string | null;
  selectedConnectionId: string | null;
  isPaletteOpen: boolean;
  dashboardMetricSelections: MetricSelection[];

  selectComponent: (id: string | null) => void;
  selectConnection: (id: string | null) => void;
  togglePalette: () => void;
  addMetricSelection: (selection: MetricSelection) => void;
  removeMetricSelection: (componentId: string, metricName: string) => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  selectedComponentId: null,
  selectedConnectionId: null,
  isPaletteOpen: true,
  dashboardMetricSelections: [],

  selectComponent: (id) =>
    set({ selectedComponentId: id, selectedConnectionId: null }),

  selectConnection: (id) =>
    set({ selectedConnectionId: id, selectedComponentId: null }),

  togglePalette: () =>
    set((state) => ({ isPaletteOpen: !state.isPaletteOpen })),

  addMetricSelection: (selection) =>
    set((state) => ({
      dashboardMetricSelections: [...state.dashboardMetricSelections, selection],
    })),

  removeMetricSelection: (componentId, metricName) =>
    set((state) => ({
      dashboardMetricSelections: state.dashboardMetricSelections.filter(
        (s) => !(s.componentId === componentId && s.metricName === metricName),
      ),
    })),
}));
