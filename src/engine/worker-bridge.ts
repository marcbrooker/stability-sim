/**
 * Worker bridge — typed API for communicating with the simulation Web Worker.
 *
 * Thin wrapper around postMessage / onmessage that provides a typed interface
 * for sending MainToWorker commands and dispatching WorkerToMain responses
 * to registered callbacks.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */

import type { MainToWorker, WorkerToMain } from '../types/worker-protocol';
import type { Architecture, SimulationConfig } from '../types/models';
import type { MetricSnapshot } from '../types/metrics';

/** Callback handlers for messages received from the worker */
export interface WorkerBridgeCallbacks {
  onMetrics?: (snapshot: MetricSnapshot) => void;
  onCompleted?: () => void;
  onPaused?: (simTime: number) => void;
  onError?: (message: string) => void;
}

export class WorkerBridge {
  private worker: Worker;
  private callbacks: WorkerBridgeCallbacks;

  constructor(callbacks: WorkerBridgeCallbacks = {}) {
    this.callbacks = callbacks;
    this.worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = (event) => {
      this.callbacks.onError?.(`Worker error: ${event.message}`);
    };
  }

  /** Dispatch incoming WorkerToMain messages to the appropriate callback */
  private handleMessage(event: MessageEvent<WorkerToMain>): void {
    const msg = event.data;
    switch (msg.type) {
      case 'metrics':
        this.callbacks.onMetrics?.(msg.snapshot);
        break;
      case 'completed':
        this.callbacks.onCompleted?.();
        break;
      case 'paused':
        this.callbacks.onPaused?.(msg.simTime);
        break;
      case 'error':
        this.callbacks.onError?.(msg.message);
        break;
    }
  }

  private post(msg: MainToWorker): void {
    this.worker.postMessage(msg);
  }

  /** Start the simulation. Req 12.1 */
  start(architecture: Architecture, config: SimulationConfig, seed: number): void {
    this.post({ type: 'start', architecture, config, seed });
  }

  /** Pause the simulation, preserving state. Req 12.2 */
  pause(): void {
    this.post({ type: 'pause' });
  }

  /** Resume a paused simulation. Req 12.1 */
  resume(): void {
    this.post({ type: 'resume' });
  }

  /** Process exactly one event. Req 12.3 */
  step(): void {
    this.post({ type: 'step' });
  }

  /** Reset the simulation to initial state. Req 12.5 */
  reset(): void {
    this.post({ type: 'reset' });
  }

  /** Update the speed multiplier. Req 12.4 */
  setSpeed(multiplier: number): void {
    this.post({ type: 'setSpeed', multiplier });
  }

  /** Update callback handlers */
  setCallbacks(callbacks: WorkerBridgeCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Terminate the worker and clean up */
  destroy(): void {
    this.worker.terminate();
  }
}
