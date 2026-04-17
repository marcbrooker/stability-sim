# AGENTS.md — Coding Agent Guidelines for Stability Sim

## Project Overview

Stability Sim is a browser-based discrete-event simulation builder for distributed systems. It uses TypeScript, React 19, React Flow, Recharts, Zustand, and Vitest. The simulation engine runs in a Web Worker.

## Build & Test Commands

```bash
npm run build        # Type-check (tsc) then Vite production build
npm test             # Run all tests once (vitest --run)
npm run lint         # ESLint
npm run dev          # Dev server (do not run in automated pipelines)
```

## Code Quality Tasks

### Before Every Change

1. Run `npm run build` to confirm the project compiles cleanly. Fix any type errors before proceeding.
2. Run `npm test` to confirm all existing tests pass.
3. Run `npm run lint` and resolve any warnings or errors.

### When Modifying Simulation Engine Code (`src/engine/`)

- Every component model (`src/engine/components/*.ts`) has a corresponding `.test.ts` file. If you change a component's behavior, update or add tests in the matching test file.
- Property-based tests (files ending in `.property.test.ts`) use `fast-check`. Keep property tests focused on invariants (e.g., priority queue ordering, PRNG determinism, serialization round-trips, metric monotonicity). Do not delete or weaken property tests without justification.
- The simulation engine must remain deterministic for a given seed. Never introduce `Math.random()` or `Date.now()` into engine code — use the `SeededRNG` from `src/engine/prng.ts`.
- The engine runs in a Web Worker (`src/engine/worker.ts`). Do not import DOM APIs or React in any file under `src/engine/`.

### When Modifying Types (`src/types/`)

- All shared types are re-exported through `src/types/index.ts`. If you add a new type file, export it from the barrel.
- Changing a type that appears in the worker protocol (`src/types/worker-protocol.ts`) or serialization models (`src/types/models.ts`) is a breaking change — update the serializers, worker, and all consumers.

### When Modifying UI Components (`src/components/`)

- Custom React Flow node types live in `src/components/nodes/` and are registered in `src/components/nodes/index.ts`. Adding a new component type requires a new node renderer and an entry in that index.
- State lives in Zustand stores (`src/stores/`). Components should read state via selectors, not by importing the store and calling `getState()` in render paths.

### When Modifying Persistence (`src/persistence/`)

- Serializers must maintain the round-trip property: `parse(serialize(x))` must produce a value equivalent to `x`. This is enforced by property-based tests.
- The URL codec (`url-codec.ts`) compresses scenarios with deflate-raw + base64url for `?s=` sharing. It uses the native `CompressionStream` API — no external dependencies.
- Schema migrations (`migrate.ts`) run before validation on every load (JSON file or shared URL). See "When Changing the Saved Scenario Schema" below.

### When Changing the Saved Scenario Schema

Saved scenarios (JSON files and `?s=` URLs) carry a top-level `schemaVersion`. The migration pipeline in `src/persistence/migrate.ts` upgrades old data to the latest format so the rest of the codebase only ever sees `CURRENT_VERSION`.

To evolve the schema:

1. Bump `CURRENT_VERSION` in `src/persistence/migrate.ts`.
2. Write a migration function (e.g., `migrateV1toV2(data)`) that transforms the old shape to the new one. This is a pure function on a plain object — no imports from the type system needed.
3. Append it to the `migrations` array in the same file.
4. Add a test in `src/persistence/migrate.test.ts` that feeds old-format data through `migrate()` and checks the output.

The `validateScenario()` function in `SaveLoadButtons.tsx` calls `migrate()` before structural validation, so all load paths (JSON file, `?s=` URL) go through migration automatically.

Existing shared URLs and saved JSON files will keep working as long as the migration chain is maintained. Never remove a migration function — they're cumulative.

**Test requirements for migrations:**

- `migrate.test.ts` — unit tests: each migration must have a test that feeds old-format data through `migrate()` and asserts the output shape. Add one per version bump.
- `migrate.property.test.ts` — property tests that verify structural invariants across all migrations: output passes `validateScenario`, idempotency (`migrate(migrate(x)) ≡ migrate(x)`), no input mutation, and migration chain length matches `CURRENT_VERSION - 1`. These tests do not need updating when adding a new migration — they run automatically against whatever the current chain is.
- `url-codec.property.test.ts` — property tests for the URL codec round-trip (`decode(encode(x)) ≡ x`). Update if the codec format changes.

### When Adding a New Component Type

1. Define its config type in `src/types/configs.ts` and add it to the `ComponentConfig` union in `src/types/components.ts`.
2. Implement the `SimComponent` interface in a new file under `src/engine/components/`.
3. Write unit tests in a matching `.test.ts` file.
4. Add a case to the `buildComponent` factory in `src/engine/worker.ts`.
5. Create a React Flow node renderer in `src/components/nodes/` and register it in `src/components/nodes/index.ts`.
6. Add a default config case in `App.tsx` (`defaultConfig` function).
7. Add the type to the component palette in `src/components/ComponentPalette.tsx`.
8. Add `'your-type'` to `ComponentType` in `src/types/components.ts`.
9. Update the properties panel in `src/components/PropertiesPanel.tsx` to handle the new config.
10. Update serializers if the new config introduces types not already covered.

### When Adding a New Failure Scenario Type

1. Add the type to the `FailureScenario` union in `src/types/failures.ts`.
2. Add `extractScenarioDetails`, `applyFailure`, and `removeFailure` cases in `src/engine/failure-injector.ts`.
3. Add the label to `SCENARIO_LABELS` and a `describeScenario` case in `src/components/FailureScenariosPanel.tsx`.
4. Add target filtering, `handleAdd` case, and any parameter inputs to the same panel.
5. If the scenario sets state on a component (e.g., `setErrorRate`), add the setter to the component, include it in `getMetrics`, and clear it in `reset`.

### When Adding a New Example

1. Add the example object in `src/examples/index.ts` and include it in the `EXAMPLES` array.
2. The `id` field is used for deep linking (`?example=<id>`). Keep it URL-safe (lowercase, hyphens).
3. Example loading logic lives in `src/examples/load-example.ts` — shared by `ExamplesMenu` and the URL handler.

## Conventions

- Use `type` imports for type-only imports (`import type { ... }`).
- Prefer immutable patterns in stores — return new objects/arrays rather than mutating.
- Test files sit next to the source files they test (e.g., `server.ts` / `server.test.ts`).
- Property-based test files use the `.property.test.ts` suffix.
- The Web Worker protocol is defined in `src/types/worker-protocol.ts`. All messages between the main thread and worker must go through this typed protocol.

## Common Pitfalls

- Importing from `src/engine/` in UI code (or vice versa) breaks the worker boundary. The only bridge is `src/engine/worker-bridge.ts`.
- Forgetting to handle a new `EventKind` in a component's `handleEvent` will silently drop events.
- Changing the priority queue comparison logic can break simulation determinism across all tests.
- The `MetricCollector` is shared state inside the engine — record metrics via `context.recordMetric()`, not by importing the collector directly in components.
- CPU reduction reduces concurrency *slots* — the Server instantly rejects excess arrivals. This does NOT cause queue buildup. Use a latency spike instead if you want queues to grow (items take longer but are still accepted).
- Servers are terminal processors — they handle a request and send a departure back to the origin. They do NOT forward to downstream components. Multi-tier service chains are not possible with the current component model.
- Origin rewriting (`originClientId`) is how Queue, LoadBalancer, Cache, and Throttle intercept responses. If you add a new pass-through component, it must stash the real origin on arrival and restore it on departure, or responses won't route back correctly.
- Loaded JSON files can crash the app if the config format has changed. `validateScenario()` in `SaveLoadButtons.tsx` catches structural issues; the `ErrorBoundary` in `main.tsx` catches render crashes from stale data that passes validation. If you changed the schema, add a migration — see "When Changing the Saved Scenario Schema".
- The `dist/` directory is NOT rebuilt by `cdk deploy`. Always run `npm run build` before deploying. The CDK stack is in `infra/`.
