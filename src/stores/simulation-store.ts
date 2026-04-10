import { create } from 'zustand';
import type { SimulationConfig, FailureScenario } from '../types';

type SimulationStatus = 'idle' | 'running' | 'paused' | 'completed';

interface SimulationState {
  status: SimulationStatus;
  currentTime: number;
  speedMultiplier: number;
  simulationConfig: SimulationConfig | null;
  failureScenarios: FailureScenario[];

  setStatus: (status: SimulationStatus) => void;
  setCurrentTime: (time: number) => void;
  setSpeed: (multiplier: number) => void;
  setSimulationConfig: (config: SimulationConfig | null) => void;
  addFailureScenario: (scenario: FailureScenario) => void;
  removeFailureScenario: (index: number) => void;
  clearFailureScenarios: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  status: 'idle',
  currentTime: 0,
  speedMultiplier: 3,
  simulationConfig: null,
  failureScenarios: [],

  setStatus: (status) => set({ status }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setSpeed: (speedMultiplier) => set({ speedMultiplier }),
  setSimulationConfig: (simulationConfig) => set({ simulationConfig }),
  addFailureScenario: (scenario) =>
    set((state) => ({ failureScenarios: [...state.failureScenarios, scenario] })),
  removeFailureScenario: (index) =>
    set((state) => ({
      failureScenarios: state.failureScenarios.filter((_, i) => i !== index),
    })),
  clearFailureScenarios: () => set({ failureScenarios: [] }),
}));
