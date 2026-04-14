import type { ComponentType, ComponentConfig } from './components';
import type { FailureScenario } from './failures';

/** A component definition within a saved architecture */
export interface ComponentDefinition {
  id: string;
  type: ComponentType;
  label: string;
  position: { x: number; y: number };
  config: ComponentConfig;
  notes?: string;
}

/** A directed connection between two components */
export interface ConnectionDefinition {
  id: string;
  sourceId: string;
  targetId: string;
}

/** A complete architecture (persisted format) */
export interface Architecture {
  schemaVersion: number;
  name: string;
  components: ComponentDefinition[];
  connections: ConnectionDefinition[];
}

/** Simulation configuration (persisted format) */
export interface SimulationConfig {
  schemaVersion: number;
  name: string;
  endTime: number;
  metricsWindowSize: number;
  failureScenarios: FailureScenario[];
  seed: number;
}
