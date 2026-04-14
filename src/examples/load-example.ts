import { useArchitectureStore } from '../stores/architecture-store';
import { useSimulationStore } from '../stores/simulation-store';
import { useMetricsStore } from '../stores/metrics-store';
import type { Example } from './index';

/**
 * Load an example into the stores, resetting any running simulation.
 * Used by both ExamplesMenu and the URL deep-link handler.
 */
export function loadExample(example: Example): void {
  const arch = example.architecture;
  const config = example.simulationConfig;

  useSimulationStore.getState().setStatus('idle');
  useSimulationStore.getState().setCurrentTime(0);
  useSimulationStore.getState().setSimulationConfig({
    ...config,
    failureScenarios: [],
  });
  useSimulationStore.getState().clearFailureScenarios();
  useMetricsStore.getState().reset();

  for (const scenario of config.failureScenarios) {
    useSimulationStore.getState().addFailureScenario(scenario);
  }

  useArchitectureStore.getState().setArchitecture(
    arch.name,
    arch.components,
    arch.connections,
  );

  // Update URL bar with deep link (without triggering navigation)
  const url = new URL(window.location.href);
  url.searchParams.set('example', example.id);
  window.history.replaceState({}, '', url.toString());
}
