import { useCallback, useState } from 'react';
import { EXAMPLES } from '../examples';
import { useArchitectureStore } from '../stores/architecture-store';
import { useSimulationStore } from '../stores/simulation-store';
import { useMetricsStore } from '../stores/metrics-store';
import type { Example } from '../examples';

/**
 * Dropdown menu for loading built-in example scenarios.
 * Loads both the architecture and simulation config (including failure scenarios)
 * into the respective stores, resetting any running simulation.
 */
export function ExamplesMenu() {
  const [open, setOpen] = useState(false);

  const loadExample = useCallback((example: Example) => {
    const arch = example.architecture;
    const config = example.simulationConfig;

    // Reset simulation state
    useSimulationStore.getState().setStatus('idle');
    useSimulationStore.getState().setCurrentTime(0);
    // Store the config with empty failureScenarios — scenarios go into the store instead
    useSimulationStore.getState().setSimulationConfig({
      ...config,
      failureScenarios: [],
    });
    useSimulationStore.getState().clearFailureScenarios();
    useMetricsStore.getState().reset();

    // Load failure scenarios from the example config into the store
    for (const scenario of config.failureScenarios) {
      useSimulationStore.getState().addFailureScenario(scenario);
    }

    // Load architecture
    useArchitectureStore.getState().setArchitecture(
      arch.name,
      arch.components,
      arch.connections,
    );

    setOpen(false);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <button className="sim-btn" onClick={() => setOpen(!open)} title="Load an example scenario">
        Examples ▾
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 100,
              background: '#1e1e36',
              border: '1px solid #3a3a5a',
              borderRadius: 6,
              minWidth: 320,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              padding: 4,
              marginTop: 4,
            }}
          >
            {EXAMPLES.map((ex) => (
              <ExampleItem key={ex.id} example={ex} onSelect={loadExample} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExampleItem({
  example,
  onSelect,
}: {
  example: Example;
  onSelect: (ex: Example) => void;
}) {
  return (
    <button
      onClick={() => onSelect(example)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        padding: '8px 10px',
        cursor: 'pointer',
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = '#2a2a4a';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13 }}>{example.name}</div>
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
        {example.description}
      </div>
    </button>
  );
}
