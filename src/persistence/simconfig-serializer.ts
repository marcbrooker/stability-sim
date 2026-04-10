import type { SimulationConfig } from '../types/models';

/**
 * Serialize a SimulationConfig to a JSON string with schemaVersion: 1.
 */
export function serialize(config: SimulationConfig): string {
  const output: SimulationConfig = {
    schemaVersion: 1,
    name: config.name,
    endTime: config.endTime,
    metricsWindowSize: config.metricsWindowSize,
    failureScenarios: config.failureScenarios,
    seed: config.seed,
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Parse a JSON string into a SimulationConfig, validating all required fields.
 * Throws a descriptive error if the JSON is malformed or missing required fields.
 */
export function parse(json: string): SimulationConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON: unable to parse input string');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid SimulationConfig: expected a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion === undefined) {
    throw new Error('Invalid SimulationConfig: missing required field "schemaVersion"');
  }
  if (typeof obj.schemaVersion !== 'number') {
    throw new Error('Invalid SimulationConfig: "schemaVersion" must be a number');
  }

  if (obj.name === undefined) {
    throw new Error('Invalid SimulationConfig: missing required field "name"');
  }
  if (typeof obj.name !== 'string') {
    throw new Error('Invalid SimulationConfig: "name" must be a string');
  }

  if (obj.endTime === undefined) {
    throw new Error('Invalid SimulationConfig: missing required field "endTime"');
  }
  if (typeof obj.endTime !== 'number') {
    throw new Error('Invalid SimulationConfig: "endTime" must be a number');
  }

  if (obj.metricsWindowSize === undefined) {
    throw new Error('Invalid SimulationConfig: missing required field "metricsWindowSize"');
  }
  if (typeof obj.metricsWindowSize !== 'number') {
    throw new Error('Invalid SimulationConfig: "metricsWindowSize" must be a number');
  }

  if (obj.failureScenarios === undefined) {
    throw new Error('Invalid SimulationConfig: missing required field "failureScenarios"');
  }
  if (!Array.isArray(obj.failureScenarios)) {
    throw new Error('Invalid SimulationConfig: "failureScenarios" must be an array');
  }

  if (obj.seed === undefined) {
    throw new Error('Invalid SimulationConfig: missing required field "seed"');
  }
  if (typeof obj.seed !== 'number') {
    throw new Error('Invalid SimulationConfig: "seed" must be a number');
  }

  return obj as unknown as SimulationConfig;
}
