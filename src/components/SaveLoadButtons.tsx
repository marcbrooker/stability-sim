import { useCallback, useState } from 'react';
import { useArchitectureStore } from '../stores/architecture-store';
import { useSimulationStore } from '../stores/simulation-store';
import { useMetricsStore } from '../stores/metrics-store';
import { encodeScenario } from '../persistence/url-codec';
import { migrate, CURRENT_VERSION } from '../persistence/migrate';
import type { Architecture, SimulationConfig } from '../types';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface SavedScenario {
  schemaVersion: number;
  architecture: Architecture;
  simulationConfig: SimulationConfig;
}

/**
 * Migrate (if needed) and validate a loaded scenario before putting it into stores.
 */
export function validateScenario(data: unknown): SavedScenario {
  const obj = migrate(data);

  if (!obj.architecture || typeof obj.architecture !== 'object') {
    throw new Error('Missing or invalid "architecture" field');
  }
  const arch = obj.architecture as Record<string, unknown>;
  if (!Array.isArray(arch.components)) {
    throw new Error('architecture.components must be an array');
  }
  if (!Array.isArray(arch.connections)) {
    throw new Error('architecture.connections must be an array');
  }
  for (let i = 0; i < arch.components.length; i++) {
    const c = arch.components[i] as Record<string, unknown>;
    if (!c || typeof c.id !== 'string' || typeof c.type !== 'string') {
      throw new Error(`architecture.components[${i}] is missing id or type`);
    }
    if (!c.config || typeof c.config !== 'object') {
      throw new Error(`architecture.components[${i}] is missing config`);
    }
  }

  if (!obj.simulationConfig || typeof obj.simulationConfig !== 'object') {
    throw new Error('Missing or invalid "simulationConfig" field');
  }
  const config = obj.simulationConfig as Record<string, unknown>;
  if (typeof config.endTime !== 'number') {
    throw new Error('simulationConfig.endTime must be a number');
  }
  if (!Array.isArray(config.failureScenarios)) {
    (config as Record<string, unknown>).failureScenarios = [];
  }

  return data as SavedScenario;
}

export function buildScenario(): SavedScenario {
  const { name, components, connections } = useArchitectureStore.getState();
  const simStore = useSimulationStore.getState();
  const config = simStore.simulationConfig;

  return {
    schemaVersion: CURRENT_VERSION,
    architecture: { schemaVersion: CURRENT_VERSION, name: name || 'Untitled', components, connections },
    simulationConfig: {
      schemaVersion: CURRENT_VERSION,
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
}

export function loadScenarioIntoStores(scenario: SavedScenario): void {
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
}

export function SaveLoadButtons() {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState('Share');

  const handleSave = useCallback(async () => {
    const scenario = buildScenario();
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
          const raw = JSON.parse(reader.result as string);
          const scenario = validateScenario(raw);
          loadScenarioIntoStores(scenario);
        } catch (err: unknown) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const handleShare = useCallback(async () => {
    try {
      const scenario = buildScenario();
      const encoded = await encodeScenario(scenario);
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('s', encoded);
      const shareUrl = url.toString();
      window.history.replaceState({}, '', shareUrl);
      await navigator.clipboard.writeText(shareUrl);
      setShareLabel('Copied!');
      setTimeout(() => setShareLabel('Share'), 2000);
    } catch {
      setShareLabel('Failed');
      setTimeout(() => setShareLabel('Share'), 2000);
    }
  }, []);

  return (
    <>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={handleSave} title="Save scenario to JSON file">
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={handleLoad} title="Load scenario from JSON file">
          Load
        </Button>
        <Button variant="outline" size="sm" onClick={handleShare} title="Copy shareable URL to clipboard">
          {shareLabel}
        </Button>
      </div>
      <Dialog open={!!loadError} onOpenChange={(open) => !open && setLoadError(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Failed to load scenario</DialogTitle>
            <DialogDescription className="text-destructive">{loadError}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground italic">
            This can happen when loading a file saved with an older version of the simulator.
            The format may have changed since the file was created.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
