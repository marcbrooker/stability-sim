import { describe, it, expect } from 'vitest';
import { validateScenario } from './SaveLoadButtons';

/** A minimal valid scenario matching the current schema */
function validScenario() {
  return {
    schemaVersion: 1,
    architecture: {
      schemaVersion: 1,
      name: 'Test',
      components: [
        {
          id: 'srv-1',
          type: 'server',
          label: 'Server',
          position: { x: 0, y: 0 },
          config: { type: 'server', serviceTimeDistribution: { type: 'exponential', mean: 0.1 }, concurrencyLimit: 10 },
        },
      ],
      connections: [],
    },
    simulationConfig: {
      schemaVersion: 1,
      name: 'Test',
      endTime: 60,
      metricsWindowSize: 1,
      seed: 42,
      failureScenarios: [],
    },
  };
}

describe('validateScenario', () => {
  it('accepts a valid scenario', () => {
    expect(() => validateScenario(validScenario())).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validateScenario(null)).toThrow('Expected a JSON object');
  });

  it('rejects a string', () => {
    expect(() => validateScenario('hello')).toThrow('Expected a JSON object');
  });

  it('rejects missing architecture', () => {
    const data = { ...validScenario(), architecture: undefined };
    expect(() => validateScenario(data)).toThrow('Missing or invalid "architecture"');
  });

  it('rejects architecture without components array', () => {
    const data = validScenario();
    (data.architecture as Record<string, unknown>).components = 'not-an-array';
    expect(() => validateScenario(data)).toThrow('components must be an array');
  });

  it('rejects architecture without connections array', () => {
    const data = validScenario();
    (data.architecture as Record<string, unknown>).connections = null;
    expect(() => validateScenario(data)).toThrow('connections must be an array');
  });

  it('rejects component without id', () => {
    const data = validScenario();
    (data.architecture.components[0] as Record<string, unknown>).id = 123;
    expect(() => validateScenario(data)).toThrow('components[0] is missing id or type');
  });

  it('rejects component without config', () => {
    const data = validScenario();
    delete (data.architecture.components[0] as Record<string, unknown>).config;
    expect(() => validateScenario(data)).toThrow('components[0] is missing config');
  });

  it('rejects missing simulationConfig', () => {
    const data = { ...validScenario(), simulationConfig: undefined };
    expect(() => validateScenario(data)).toThrow('Missing or invalid "simulationConfig"');
  });

  it('rejects simulationConfig without endTime', () => {
    const data = validScenario();
    (data.simulationConfig as Record<string, unknown>).endTime = 'not-a-number';
    expect(() => validateScenario(data)).toThrow('endTime must be a number');
  });

  it('tolerates missing failureScenarios by defaulting to empty array', () => {
    const data = validScenario();
    delete (data.simulationConfig as Record<string, unknown>).failureScenarios;
    const result = validateScenario(data);
    expect(result.simulationConfig.failureScenarios).toEqual([]);
  });

  it('accepts a scenario with old-format component configs (unknown fields pass through)', () => {
    // An old throttle config with maxConcurrency at the top level instead of mode
    const data = validScenario();
    data.architecture.components.push({
      id: 'throttle-1',
      type: 'throttle',
      label: 'Throttle',
      position: { x: 100, y: 100 },
      config: { type: 'throttle', maxConcurrency: 10 } as never,
    });
    // Validation should NOT throw — it only checks structural fields, not config internals.
    // The crash would happen later during rendering, which the ErrorBoundary catches.
    expect(() => validateScenario(data)).not.toThrow();
  });

  it('rejects completely empty object', () => {
    expect(() => validateScenario({})).toThrow();
  });

  it('rejects an array', () => {
    expect(() => validateScenario([])).toThrow();
  });
});
