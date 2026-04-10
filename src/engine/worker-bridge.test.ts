import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkerToMain } from '../types/worker-protocol';
import type { MetricSnapshot } from '../types/metrics';

// Mock the Worker constructor before importing WorkerBridge
const mockPostMessage = vi.fn();
const mockTerminate = vi.fn();
vi.stubGlobal('Worker', class {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = mockPostMessage;
  terminate = mockTerminate;
});

// Also mock import.meta.url for the URL constructor
vi.stubGlobal('URL', class {
  constructor(public path: string, public base?: string) {}
});

import { WorkerBridge } from './worker-bridge';

describe('WorkerBridge', () => {
  let bridge: WorkerBridge;

  beforeEach(() => {
    mockPostMessage.mockClear();
    mockTerminate.mockClear();
  });

  afterEach(() => {
    bridge?.destroy();
  });

  function simulateWorkerMessage(msg: WorkerToMain): void {
    // The bridge sets onmessage in the constructor, so we grab it from the instance
    // We need to trigger it directly since our mock doesn't auto-capture
    const worker = (bridge as unknown as { worker: { onmessage: ((e: MessageEvent) => void) | null } }).worker;
    worker.onmessage?.({ data: msg } as MessageEvent<WorkerToMain>);
  }

  describe('posting MainToWorker messages', () => {
    it('start() posts a start message with architecture, config, and seed', () => {
      bridge = new WorkerBridge();
      const arch = { schemaVersion: 1, name: 'test', components: [], connections: [] };
      const config = {
        schemaVersion: 1, name: 'cfg', endTime: 100,
        metricsWindowSize: 10, failureScenarios: [], seed: 0,
      };
      bridge.start(arch, config, 42);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'start',
        architecture: arch,
        config,
        seed: 42,
      });
    });

    it('pause() posts a pause message', () => {
      bridge = new WorkerBridge();
      bridge.pause();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'pause' });
    });

    it('resume() posts a resume message', () => {
      bridge = new WorkerBridge();
      bridge.resume();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'resume' });
    });

    it('step() posts a step message', () => {
      bridge = new WorkerBridge();
      bridge.step();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'step' });
    });

    it('reset() posts a reset message', () => {
      bridge = new WorkerBridge();
      bridge.reset();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'reset' });
    });

    it('setSpeed() posts a setSpeed message with multiplier', () => {
      bridge = new WorkerBridge();
      bridge.setSpeed(2.5);
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'setSpeed', multiplier: 2.5 });
    });
  });

  describe('dispatching WorkerToMain messages', () => {
    it('dispatches metrics messages to onMetrics callback', () => {
      const onMetrics = vi.fn();
      bridge = new WorkerBridge({ onMetrics });

      const snapshot: MetricSnapshot = {
        simTime: 50,
        componentMetrics: {},
        latencyPercentiles: { p50: 1, p95: 2, p99: 3, p999: 4 },
        completedCount: 10,
        failedCount: 1,
      };
      simulateWorkerMessage({ type: 'metrics', snapshot });

      expect(onMetrics).toHaveBeenCalledWith(snapshot);
    });

    it('dispatches completed messages to onCompleted callback', () => {
      const onCompleted = vi.fn();
      bridge = new WorkerBridge({ onCompleted });

      simulateWorkerMessage({ type: 'completed' });

      expect(onCompleted).toHaveBeenCalled();
    });

    it('dispatches paused messages to onPaused callback with simTime', () => {
      const onPaused = vi.fn();
      bridge = new WorkerBridge({ onPaused });

      simulateWorkerMessage({ type: 'paused', simTime: 75.5 });

      expect(onPaused).toHaveBeenCalledWith(75.5);
    });

    it('dispatches error messages to onError callback', () => {
      const onError = vi.fn();
      bridge = new WorkerBridge({ onError });

      simulateWorkerMessage({ type: 'error', message: 'something broke' });

      expect(onError).toHaveBeenCalledWith('something broke');
    });

    it('does not throw when no callback is registered for a message type', () => {
      bridge = new WorkerBridge();

      expect(() => {
        simulateWorkerMessage({ type: 'completed' });
        simulateWorkerMessage({ type: 'error', message: 'oops' });
        simulateWorkerMessage({ type: 'paused', simTime: 0 });
        simulateWorkerMessage({
          type: 'metrics',
          snapshot: {
            simTime: 0, componentMetrics: {},
            latencyPercentiles: { p50: 0, p95: 0, p99: 0, p999: 0 },
            completedCount: 0, failedCount: 0,
          },
        });
      }).not.toThrow();
    });
  });

  describe('setCallbacks', () => {
    it('replaces callbacks so new messages go to the new handlers', () => {
      const onError1 = vi.fn();
      const onError2 = vi.fn();
      bridge = new WorkerBridge({ onError: onError1 });

      simulateWorkerMessage({ type: 'error', message: 'first' });
      expect(onError1).toHaveBeenCalledWith('first');

      bridge.setCallbacks({ onError: onError2 });
      simulateWorkerMessage({ type: 'error', message: 'second' });

      expect(onError2).toHaveBeenCalledWith('second');
      expect(onError1).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('terminates the worker', () => {
      bridge = new WorkerBridge();
      bridge.destroy();
      expect(mockTerminate).toHaveBeenCalled();
    });
  });
});
