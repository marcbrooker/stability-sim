import { useCallback } from 'react';
import { useArchitectureStore } from '../stores/architecture-store';
import { useSimulationStore } from '../stores/simulation-store';
import { useMetricsStore } from '../stores/metrics-store';
import type { Architecture, SimulationConfig } from '../types';

interface SavedScenario {
  schemaVersion: number;
  architecture: Architecture;
  simulationConfig: SimulationConfig;
}

export function SaveLoadButtons() {
  const handleSave = useCallback(async () => {
    const { name, components, connections } = useArchitectureStore.getState();
    const simStore = useSimulationStore.getState();
    const config = simStore.simulationConfig;

    const scenario: SavedScenario = {
      schemaVersion: 1,
      architecture: { schemaVersion: 1, name: name || 'Untitled', components, connections },
      simulationConfig: {
        schemaVersion: 1,
        name: config?.name ?? name ?? 'Untitled',
        endTime: config?.endTime ?? 60,
        metricsWindowSize: config?.metricsWindowSize ?? 1,
        seed: config?.seed ?? 42,
        failureScenarios: [
          ...(config?.failureScenarios ?? []),
          ...simStore.failureScenarios,
        ],
      },
    };

    const defaultName = scenario.architecture.name || 'scenario';
    const json = JSON.stringify(scenario, null, 2);

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> })
          .showSaveFilePicker({
            suggestedName: `${defaultName}.json`,
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        return;
      } catch {
        // User cancelled or API unavailable — fall through to legacy download
      }
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${defaultName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleLoad = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const scenario = JSON.parse(reader.result as string) as SavedScenario;
          const arch = scenario.architecture;
          const config = scenario.simulationConfig;

          useSimulationStore.getState().setStatus('idle');
          useSimulationStore.getState().setCurrentTime(0);
          useSimulationStore.getState().clearFailureScenarios();
          useSimulationStore.getState().setSimulationConfig({ ...config, failureScenarios: [] });
          useMetricsStore.getState().reset();

          for (const s of config.failureScenarios) {
            useSimulationStore.getState().addFailureScenario(s);
          }

          useArchitectureStore.getState().setArchitecture(arch.name, arch.components, arch.connections);
        } catch (err: unknown) {
          alert(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button className="sim-btn" onClick={handleSave} title="Save scenario to JSON file">
        Save
      </button>
      <button className="sim-btn" onClick={handleLoad} title="Load scenario from JSON file">
        Load
      </button>
    </div>
  );
}
