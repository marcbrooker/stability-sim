/**
 * Versioned migration pipeline for saved scenarios.
 *
 * Every saved scenario has a top-level `schemaVersion`. When loading, we run
 * migrations sequentially from the saved version up to CURRENT_VERSION.
 * Each migration is a pure function: (v_N data) → (v_N+1 data).
 *
 * To add a new migration:
 *   1. Bump CURRENT_VERSION
 *   2. Add a `function migrateVxToVy(data)` that transforms the old shape
 *   3. Append it to the `migrations` array
 *
 * The rest of the codebase only ever sees CURRENT_VERSION data.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawScenario = Record<string, any>;
type Migration = (data: RawScenario) => RawScenario;

/** The version that buildScenario() stamps and validateScenario() expects. */
export const CURRENT_VERSION = 1;

/**
 * Ordered list of migrations. migrations[0] upgrades v1→v2, migrations[1]
 * upgrades v2→v3, etc. Length must equal CURRENT_VERSION - 1.
 */
const migrations: Migration[] = [
  // When you need v1→v2, add: migrateV1toV2,
];

/**
 * Migrate a raw parsed scenario object to CURRENT_VERSION.
 * Throws if the version is missing, not a number, newer than current,
 * or if no migration path exists.
 */
export function migrate(data: unknown): RawScenario {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Expected a JSON object');
  }
  const obj = data as RawScenario;

  // Treat missing schemaVersion as version 1 (early saves didn't have it)
  const version = obj.schemaVersion ?? 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid schemaVersion: ${String(version)}`);
  }
  if (version > CURRENT_VERSION) {
    throw new Error(
      `Scenario version ${version} is newer than this build (v${CURRENT_VERSION}). ` +
      'Try refreshing the page to get the latest version.',
    );
  }

  let current = obj;
  for (let v = version; v < CURRENT_VERSION; v++) {
    current = migrations[v - 1](current);
  }
  current.schemaVersion = CURRENT_VERSION;
  return current;
}
