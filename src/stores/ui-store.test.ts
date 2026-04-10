import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui-store';

describe('useUIStore', () => {
  beforeEach(() => {
    const s = useUIStore.getState();
    s.selectComponent(null);
    s.selectConnection(null);
    // reset palette to default open
    if (!useUIStore.getState().isPaletteOpen) {
      useUIStore.getState().togglePalette();
    }
    // clear metric selections by removing all
    const sels = useUIStore.getState().dashboardMetricSelections;
    for (const sel of sels) {
      useUIStore.getState().removeMetricSelection(sel.componentId, sel.metricName);
    }
  });

  it('has correct initial state', () => {
    const s = useUIStore.getState();
    expect(s.selectedComponentId).toBeNull();
    expect(s.selectedConnectionId).toBeNull();
    expect(s.isPaletteOpen).toBe(true);
    expect(s.dashboardMetricSelections).toEqual([]);
  });

  it('selectComponent sets component and clears connection', () => {
    useUIStore.getState().selectConnection('conn-1');
    useUIStore.getState().selectComponent('comp-1');
    const s = useUIStore.getState();
    expect(s.selectedComponentId).toBe('comp-1');
    expect(s.selectedConnectionId).toBeNull();
  });

  it('selectConnection sets connection and clears component', () => {
    useUIStore.getState().selectComponent('comp-1');
    useUIStore.getState().selectConnection('conn-1');
    const s = useUIStore.getState();
    expect(s.selectedConnectionId).toBe('conn-1');
    expect(s.selectedComponentId).toBeNull();
  });

  it('togglePalette flips isPaletteOpen', () => {
    expect(useUIStore.getState().isPaletteOpen).toBe(true);
    useUIStore.getState().togglePalette();
    expect(useUIStore.getState().isPaletteOpen).toBe(false);
    useUIStore.getState().togglePalette();
    expect(useUIStore.getState().isPaletteOpen).toBe(true);
  });

  it('addMetricSelection and removeMetricSelection', () => {
    const sel = { componentId: 's1', metricName: 'throughput', chartType: 'line' as const };
    useUIStore.getState().addMetricSelection(sel);
    expect(useUIStore.getState().dashboardMetricSelections).toEqual([sel]);

    useUIStore.getState().removeMetricSelection('s1', 'throughput');
    expect(useUIStore.getState().dashboardMetricSelections).toEqual([]);
  });
});
