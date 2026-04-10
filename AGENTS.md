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
- The JSON format includes a `schemaVersion` field. If you change the serialized shape, bump the schema version and handle migration from the previous version.

### When Adding a New Component Type

1. Define its config type in `src/types/configs.ts` and add it to the `ComponentConfig` union in `src/types/components.ts`.
2. Implement the `SimComponent` interface in a new file under `src/engine/components/`.
3. Write unit tests in a matching `.test.ts` file.
4. Add a case to the `buildComponent` factory in `src/engine/worker.ts`.
5. Create a React Flow node renderer in `src/components/nodes/` and register it in `src/components/nodes/index.ts`.
6. Add a default config case in `App.tsx` (`defaultConfig` function).
7. Add the type to the component palette in `src/components/ComponentPalette.tsx`.
8. Update the properties panel in `src/components/PropertiesPanel.tsx` to handle the new config.
9. Update serializers if the new config introduces types not already covered.

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
