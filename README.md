# Stability Sim

A browser-based discrete-event simulation builder for distributed systems. Compose architectures from abstract components, define traffic patterns and failure scenarios, and observe emergent behaviors like metastable failures, retry amplification, queue buildup, and congestive collapse — all in your browser, no backend required.

## What It Does

Stability Sim lets you visually build a distributed system topology from standard building blocks:

- **Client** — generates traffic using open-loop (Poisson), closed-loop, ramping, or burst patterns. Supports retry strategies: none, fixed-N, token bucket, and circuit breaker.
- **Load Balancer** — distributes work across downstream components via round-robin, random, or least-connections.
- **Server** — processes work units with configurable service time distributions (uniform, exponential, log-normal), concurrency limits, and optional load-dependent latency scaling.
- **Cache** — resolves requests as hits with a configurable probability; misses are forwarded downstream.
- **Queue** — FIFO buffer with configurable capacity and optional load-shedding thresholds.
- **Database** — models read/write latency distributions, connection pool limits, and load-dependent latency.

Once you've wired up an architecture, you can inject failures (server crash, latency spike, CPU reduction, network partition) at specific simulation times and watch the system respond in real time through a metrics dashboard showing latency percentiles, throughput, queue depth, utilization, and success rates.

## How It Works

The simulation is a priority-queue-driven discrete-event engine. Events (arrivals, departures, failures, recoveries, timeouts) are processed in strict timestamp order. A seedable xoshiro128** PRNG ensures deterministic, reproducible results.

The engine runs in a **Web Worker** so the UI stays responsive. The main thread and worker communicate via a typed message protocol (`start`, `pause`, `resume`, `step`, `reset`, `setSpeed`). Metric snapshots are posted back at regular simulation-time intervals and rendered as live charts.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  UI Layer (React + React Flow + Recharts)            │
│  Builder canvas, properties panel, dashboard, controls│
├─────────────────────────────────────────────────────┤
│  State Layer (Zustand)                               │
│  Architecture store, simulation store, metrics store  │
├─────────────────────────────────────────────────────┤
│  Engine Layer (Web Worker)                           │
│  SimulationEngine, PriorityQueue, MetricCollector,   │
│  Component models, FailureInjector, SeededRNG        │
├─────────────────────────────────────────────────────┤
│  Persistence Layer                                   │
│  JSON serializers for architectures & sim configs    │
└─────────────────────────────────────────────────────┘
```

- **UI Layer**: React Flow for the node-graph editor (drag-and-drop components, draw connections), Recharts for time-series and histogram visualizations.
- **State Layer**: Zustand stores manage architecture definitions, simulation status, UI selections, and accumulated metrics.
- **Engine Layer**: The core simulation loop, component models, and metric collection all run inside a Web Worker. Each component type implements a `handleEvent` interface so the engine dispatches events uniformly.
- **Persistence Layer**: Architectures and simulation configs serialize to versioned JSON and can be saved/loaded via the browser File API.

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install & Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`).

### Build for Production

```bash
npm run build
npm run preview
```

### Run Tests

```bash
npm test
```

This runs unit tests and property-based tests (via Vitest and fast-check).

### Lint

```bash
npm run lint
```

## Usage

1. Drag components from the palette on the left onto the canvas.
2. Connect components by dragging from one node's handle to another.
3. Select a component to configure its parameters in the properties panel on the right.
4. Use the top bar controls to start, pause, step, or reset the simulation.
5. Watch metrics update live in the dashboard at the bottom.
6. Save/load architectures and simulation configs as JSON files.

## Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| UI | React 19, React Flow, Recharts |
| State | Zustand |
| Simulation | Web Worker, priority-queue discrete-event engine |
| PRNG | Seedable xoshiro128** |
| Build | Vite |
| Test | Vitest + fast-check (property-based) |

## Project Structure

```
src/
├── components/        # React UI components (palette, panels, node renderers)
│   └── nodes/         # Custom React Flow node types per component
├── engine/            # Simulation engine, Web Worker, PRNG, metric collector
│   └── components/    # Simulation component models (client, server, etc.)
├── persistence/       # JSON serializers for architecture & sim config
├── stores/            # Zustand state stores
└── types/             # TypeScript type definitions
```

