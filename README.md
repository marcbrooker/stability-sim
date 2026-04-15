# Stability Sim

**[Try it live at stability-sim.systems](https://stability-sim.systems/)**

A browser-based discrete-event simulation builder for distributed systems. Compose architectures from abstract components, define traffic patterns and failure scenarios, and observe emergent behaviors like metastable failures, retry amplification, queue buildup, and congestive collapse — all in your browser, no backend required.

## What It Does

Stability Sim lets you visually build a distributed system topology from standard building blocks:

- **Client** — generates traffic using open-loop (Poisson), closed-loop, ramping, or burst patterns. Supports retry strategies: none, fixed-N, token bucket, and circuit breaker.
- **Load Balancer** — distributes work across downstream components via round-robin, random, or least-connections.
- **Server** — processes work units with configurable service time distributions (uniform, exponential, log-normal), concurrency limits, and optional load-dependent latency scaling.
- **Cache** — key-based caching with TTL, LRU/FIFO eviction, and probabilistic fallback for keyless requests. Misses are forwarded downstream.
- **Queue** — FIFO buffer with configurable capacity, concurrency limits, and optional load-shedding thresholds.
- **Database** — models read/write latency distributions, connection pool limits, and load-dependent latency.
- **Throttle** — admission control with two modes: concurrency-based (reject when in-flight count exceeds limit) or RPS-based (reject when EWMA of arrival rate exceeds limit).

Once you've wired up an architecture, you can inject failures at specific simulation times and watch the system respond in real time:

- **Server crash** — takes a server offline for a duration
- **Latency spike** — multiplies service time by a factor
- **CPU reduction** — reduces effective concurrency slots
- **Network partition** — blocks traffic on a connection (bidirectional)
- **Cache flush** — clears all cached entries
- **Random error** — causes a percentage of requests to fail at random

The metrics dashboard shows latency percentiles, throughput, queue depth, utilization, and custom per-component metrics as live time-series charts.

## Built-in Examples

Load these from the Examples menu, or deep-link with `?example=<id>`:

| Example | ID | What it demonstrates |
|---|---|---|
| Metastable Failure (Retry Storm) | `metastable-retry` | Aggressive retries sustain overload after a server crash |
| GC Pressure Death Spiral | `gc-death-spiral` | Load-dependent latency creates a tipping point |
| Connection Pool Exhaustion | `connection-pool-exhaustion` | DB latency spike drains connection pool |
| Cache Stampede | `cache-stampede` | TTL expiry and queue buildup create a stampede |
| Cache Flush Metastability | `cache-flush` | Instantaneous cache loss overwhelms the backend |
| Timeout Cascade | `timeout-cascade` | High utilization + exponential variance = intermittent failure |
| LB Sinkholing | `lb-sinkholing` | Least-connections routes traffic to a crashed server |
| Goodput Collapse | `goodput-collapse` | Stale queue: high throughput but zero goodput |

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

### Deploy

The site deploys to AWS via CDK (S3 + CloudFront + Route53). See [`infra/README.md`](infra/README.md).

```bash
npm run build
cd infra && npx cdk deploy --profile <your-profile>
```

## Usage

1. Drag components from the palette on the left onto the canvas.
2. Connect components by dragging from one node's handle to another.
3. Select a component to configure its parameters in the properties panel on the right.
4. Add failure scenarios in the panel below the properties.
5. Use the top bar controls to start, pause, step, or reset the simulation.
6. Watch metrics update live in the dashboard at the bottom.
7. Save/load scenarios as JSON files, or share via deep link.

## Project Structure

```
src/
├── components/        # React UI components (palette, panels, node renderers)
│   └── nodes/         # Custom React Flow node types per component
├── engine/            # Simulation engine, Web Worker, PRNG, metric collector
│   └── components/    # Simulation component models (client, server, etc.)
├── examples/          # Built-in example scenarios and load logic
├── persistence/       # JSON serializers for architecture & sim config
├── stores/            # Zustand state stores
└── types/             # TypeScript type definitions
infra/                 # CDK deployment (S3, CloudFront, Route53)
```

## More Reading

- [Metastability and Distributed Systems](https://brooker.co.za/blog/2021/05/24/metastable.html) — Marc Brooker
- [Metastable Failures in Distributed Systems](https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s11-bronson.pdf) — Bronson, Aghayev, Charapko & Zhu (HotOS 2021)
- [Fixing Retries with Token Buckets and Circuit Breakers](https://brooker.co.za/blog/2022/02/28/retries.html) — Marc Brooker
- [Avoiding Insurmountable Queue Backlogs](https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs/) — AWS Builders Library
