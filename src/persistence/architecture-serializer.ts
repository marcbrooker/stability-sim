import type { Architecture } from '../types/models';

/**
 * Serialize an Architecture to a JSON string with schemaVersion: 1.
 */
export function serialize(architecture: Architecture): string {
  const output: Architecture = {
    schemaVersion: 1,
    name: architecture.name,
    components: architecture.components,
    connections: architecture.connections,
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Parse a JSON string into an Architecture, validating all required fields.
 * Throws a descriptive error if the JSON is malformed or missing required fields.
 */
export function parse(json: string): Architecture {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON: unable to parse input string');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid Architecture: expected a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion === undefined) {
    throw new Error('Invalid Architecture: missing required field "schemaVersion"');
  }
  if (typeof obj.schemaVersion !== 'number') {
    throw new Error('Invalid Architecture: "schemaVersion" must be a number');
  }

  if (obj.name === undefined) {
    throw new Error('Invalid Architecture: missing required field "name"');
  }
  if (typeof obj.name !== 'string') {
    throw new Error('Invalid Architecture: "name" must be a string');
  }

  if (obj.components === undefined) {
    throw new Error('Invalid Architecture: missing required field "components"');
  }
  if (!Array.isArray(obj.components)) {
    throw new Error('Invalid Architecture: "components" must be an array');
  }

  for (let i = 0; i < obj.components.length; i++) {
    validateComponent(obj.components[i], i);
  }

  if (obj.connections === undefined) {
    throw new Error('Invalid Architecture: missing required field "connections"');
  }
  if (!Array.isArray(obj.connections)) {
    throw new Error('Invalid Architecture: "connections" must be an array');
  }

  for (let i = 0; i < obj.connections.length; i++) {
    validateConnection(obj.connections[i], i);
  }

  return obj as unknown as Architecture;
}


function validateComponent(comp: unknown, index: number): void {
  if (typeof comp !== 'object' || comp === null || Array.isArray(comp)) {
    throw new Error(`Invalid Architecture: components[${index}] must be an object`);
  }
  const c = comp as Record<string, unknown>;

  if (typeof c.id !== 'string') {
    throw new Error(`Invalid Architecture: components[${index}] missing or invalid "id" (must be a string)`);
  }
  if (typeof c.type !== 'string') {
    throw new Error(`Invalid Architecture: components[${index}] missing or invalid "type" (must be a string)`);
  }
  if (typeof c.label !== 'string') {
    throw new Error(`Invalid Architecture: components[${index}] missing or invalid "label" (must be a string)`);
  }
  if (typeof c.position !== 'object' || c.position === null || Array.isArray(c.position)) {
    throw new Error(`Invalid Architecture: components[${index}] missing or invalid "position" (must be an object)`);
  }
  const pos = c.position as Record<string, unknown>;
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
    throw new Error(`Invalid Architecture: components[${index}].position must have numeric "x" and "y"`);
  }
  if (typeof c.config !== 'object' || c.config === null || Array.isArray(c.config)) {
    throw new Error(`Invalid Architecture: components[${index}] missing or invalid "config" (must be an object)`);
  }
}

function validateConnection(conn: unknown, index: number): void {
  if (typeof conn !== 'object' || conn === null || Array.isArray(conn)) {
    throw new Error(`Invalid Architecture: connections[${index}] must be an object`);
  }
  const c = conn as Record<string, unknown>;

  if (typeof c.id !== 'string') {
    throw new Error(`Invalid Architecture: connections[${index}] missing or invalid "id" (must be a string)`);
  }
  if (typeof c.sourceId !== 'string') {
    throw new Error(`Invalid Architecture: connections[${index}] missing or invalid "sourceId" (must be a string)`);
  }
  if (typeof c.targetId !== 'string') {
    throw new Error(`Invalid Architecture: connections[${index}] missing or invalid "targetId" (must be a string)`);
  }
}
