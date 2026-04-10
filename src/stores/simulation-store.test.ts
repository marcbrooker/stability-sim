import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulationStore } from './simulation-store';
import type { SimulationConfig } from '../types';

describe('useSimulationStore', () => {
  beforeEach(() => {
    const s = useSimulationStore.getState();
    s.setStatus('idle');
    s.setCurrentTime(0);
    s.setSpeed(1);
    s.setSimulationConfig(null);
  });

  it('has correct initial state', () => {
    const s = useSimulationStore.getState();
    expect(s.status).toBe('idle');
    expect(s.currentTime).toBe(0);
    expect(s.speedMultiplier).toBe(1);
    expect(s.simulationConfig).toBeNull();
  });

  it('setStatus updates status', () => {
    useSimulationStore.getState().setStatus('running');
    expect(useSimulationStore.getState().status).toBe('running');
  });

  it('setCurrentTime updates time', () => {
    useSimulationStore.getState().setCurrentTime(42.5);
    expect(useSimulationStore.getState().currentTime).toBe(42.5);
  });

  it('setSpeed updates multiplier', () => {
    useSimulationStore.getState().setSpeed(4);
    expect(useSimulationStore.getState().speedMultiplier).toBe(4);
  });

  it('setSimulationConfig stores config', () => {
    const config: SimulationConfig = {
      schemaVersion: 1,
      name: 'test',
      endTime: 1000,
      metricsWindowSize: 10,
      failureScenarios: [],
      seed: 12345,
    };
    useSimulationStore.getState().setSimulationConfig(config);
    expect(useSimulationStore.getState().simulationConfig).toEqual(config);
  });
});
