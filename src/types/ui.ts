/** A user's metric selection for the dashboard */
export interface MetricSelection {
  componentId: string;
  metricName: string;
  chartType: 'line' | 'histogram';
}

/** UI-level state for the builder */
export interface UIState {
  selectedComponentId: string | null;
  selectedConnectionId: string | null;
  isPaletteOpen: boolean;
  dashboardMetricSelections: MetricSelection[];
}
