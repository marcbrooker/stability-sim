import { describe, it, expect } from 'vitest';
import { FailureInjector } from './failure-injector';
import { Server } from './components/server';
import type { SimEvent } from '../types/events';
import type { SimComponent } from '../types/components';
import type { FailureScenario } from '../types/failures';
import type { ServerConfig } from '../types/configs';

const basicServerConfig: ServerConfig = {
  serviceTimeDistribution: { type: 'uniform', min: 1, max: 1 },
  concurrencyLimit: 4,
};

function createComponents(...servers: Server[]): Map<string, SimComponent> {
  const map = new Map<string, SimComponent>();
  for (const s of servers) {
    map.set(s.id, s);
  }
  return map;
}

describe('FailureInjector', () => {
  describe('scheduleFailures', () => {
    it('creates inject and recover event pair for server-crash', () => {
      const injector = new FailureInjector();
      const scheduled: SimEvent[] = [];
      const scenario: FailureScenario = {
        type: 'server-crash',
        targetId: 'srv-1',
        triggerTime: 100,
        recoveryTime: 200,
      };

      injector.scheduleFailures([scenario], (e) => scheduled.push(e));

      expect(scheduled).toHaveLength(2);

      const inject = scheduled.find((e) => e.kind === 'failure-inject')!;
      const recover = scheduled.find((e) => e.kind === 'failure-recover')!;

      expect(inject.timestamp).toBe(100);
      expect(inject.targetComponentId).toBe('srv-1');
      expect(inject.workUnit.metadata.failureType).toBe('server-crash');

      expect(recover.timestamp).toBe(200);
      expect(recover.targetComponentId).toBe('srv-1');
      expect(recover.workUnit.metadata.failureType).toBe('server-crash');
    });

    it('creates inject and recover event pair for latency-spike', () => {
      const injector = new FailureInjector();
      const scheduled: SimEvent[] = [];
      const scenario: FailureScenario = {
        type: 'latency-spike',
        targetId: 'srv-1',
        triggerTime: 50,
        duration: 30,
        factor: 5,
      };

      injector.scheduleFailures([scenario], (e) => scheduled.push(e));

      const inject = scheduled.find((e) => e.kind === 'failure-inject')!;
      const recover = scheduled.find((e) => e.kind === 'failure-recover')!;

      expect(inject.timestamp).toBe(50);
      expect(inject.workUnit.metadata.factor).toBe(5);

      expect(recover.timestamp).toBe(80); // 50 + 30
    });

    it('creates inject and recover event pair for cpu-reduction', () => {
      const injector = new FailureInjector();
      const scheduled: SimEvent[] = [];
      const scenario: FailureScenario = {
        type: 'cpu-reduction',
        targetId: 'srv-1',
        triggerTime: 10,
        duration: 20,
        reductionPercent: 50,
      };

      injector.scheduleFailures([scenario], (e) => scheduled.push(e));

      const inject = scheduled.find((e) => e.kind === 'failure-inject')!;
      const recover = scheduled.find((e) => e.kind === 'failure-recover')!;

      expect(inject.timestamp).toBe(10);
      expect(inject.workUnit.metadata.reductionPercent).toBe(50);

      expect(recover.timestamp).toBe(30); // 10 + 20
    });

    it('creates inject and recover event pair for network-partition', () => {
      const injector = new FailureInjector();
      const scheduled: SimEvent[] = [];
      const scenario: FailureScenario = {
        type: 'network-partition',
        connectionId: 'conn-1',
        triggerTime: 60,
        duration: 40,
      };

      injector.scheduleFailures([scenario], (e) => scheduled.push(e));

      const inject = scheduled.find((e) => e.kind === 'failure-inject')!;
      const recover = scheduled.find((e) => e.kind === 'failure-recover')!;

      expect(inject.timestamp).toBe(60);
      expect(inject.targetComponentId).toBe('conn-1');
      expect(inject.workUnit.metadata.connectionId).toBe('conn-1');

      expect(recover.timestamp).toBe(100); // 60 + 40
    });

    it('schedules multiple scenarios', () => {
      const injector = new FailureInjector();
      const scheduled: SimEvent[] = [];
      const scenarios: FailureScenario[] = [
        { type: 'server-crash', targetId: 'srv-1', triggerTime: 10, recoveryTime: 20 },
        { type: 'latency-spike', targetId: 'srv-2', triggerTime: 30, duration: 10, factor: 2 },
      ];

      injector.scheduleFailures(scenarios, (e) => scheduled.push(e));

      expect(scheduled).toHaveLength(4); // 2 pairs
    });
  });

  describe('handleFailureEvent — server-crash (Req 9.2)', () => {
    it('sets server crashed on inject', () => {
      const injector = new FailureInjector();
      const server = new Server('srv-1', basicServerConfig);
      const components = createComponents(server);
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'server-crash', targetId: 'srv-1', triggerTime: 100, recoveryTime: 200 }],
        (e) => scheduled.push(e),
      );

      const injectEvent = scheduled.find((e) => e.kind === 'failure-inject')!;
      injector.handleFailureEvent(injectEvent, components);

      expect(server.getMetrics().crashed).toBe(1);
    });

    it('clears server crashed on recover', () => {
      const injector = new FailureInjector();
      const server = new Server('srv-1', basicServerConfig);
      const components = createComponents(server);
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'server-crash', targetId: 'srv-1', triggerTime: 100, recoveryTime: 200 }],
        (e) => scheduled.push(e),
      );

      const injectEvent = scheduled.find((e) => e.kind === 'failure-inject')!;
      const recoverEvent = scheduled.find((e) => e.kind === 'failure-recover')!;

      injector.handleFailureEvent(injectEvent, components);
      expect(server.getMetrics().crashed).toBe(1);

      injector.handleFailureEvent(recoverEvent, components);
      expect(server.getMetrics().crashed).toBe(0);
    });
  });

  describe('handleFailureEvent — latency-spike (Req 9.3)', () => {
    it('sets latency spike multiplier on inject', () => {
      const injector = new FailureInjector();
      const server = new Server('srv-1', basicServerConfig);
      const components = createComponents(server);
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'latency-spike', targetId: 'srv-1', triggerTime: 50, duration: 30, factor: 5 }],
        (e) => scheduled.push(e),
      );

      const injectEvent = scheduled.find((e) => e.kind === 'failure-inject')!;
      injector.handleFailureEvent(injectEvent, components);

      expect(server.getMetrics().latencySpikeMultiplier).toBe(5);
    });

    it('resets latency spike multiplier to 1 on recover', () => {
      const injector = new FailureInjector();
      const server = new Server('srv-1', basicServerConfig);
      const components = createComponents(server);
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'latency-spike', targetId: 'srv-1', triggerTime: 50, duration: 30, factor: 5 }],
        (e) => scheduled.push(e),
      );

      const [inject, recover] = [
        scheduled.find((e) => e.kind === 'failure-inject')!,
        scheduled.find((e) => e.kind === 'failure-recover')!,
      ];

      injector.handleFailureEvent(inject, components);
      injector.handleFailureEvent(recover, components);

      expect(server.getMetrics().latencySpikeMultiplier).toBe(1);
    });
  });

  describe('handleFailureEvent — cpu-reduction (Req 9.4)', () => {
    it('sets cpu reduction on inject', () => {
      const injector = new FailureInjector();
      const server = new Server('srv-1', basicServerConfig);
      const components = createComponents(server);
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'cpu-reduction', targetId: 'srv-1', triggerTime: 10, duration: 20, reductionPercent: 75 }],
        (e) => scheduled.push(e),
      );

      const injectEvent = scheduled.find((e) => e.kind === 'failure-inject')!;
      injector.handleFailureEvent(injectEvent, components);

      expect(server.getMetrics().cpuReductionPercent).toBe(75);
    });

    it('clears cpu reduction on recover', () => {
      const injector = new FailureInjector();
      const server = new Server('srv-1', basicServerConfig);
      const components = createComponents(server);
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'cpu-reduction', targetId: 'srv-1', triggerTime: 10, duration: 20, reductionPercent: 75 }],
        (e) => scheduled.push(e),
      );

      const [inject, recover] = [
        scheduled.find((e) => e.kind === 'failure-inject')!,
        scheduled.find((e) => e.kind === 'failure-recover')!,
      ];

      injector.handleFailureEvent(inject, components);
      injector.handleFailureEvent(recover, components);

      expect(server.getMetrics().cpuReductionPercent).toBe(0);
    });
  });

  describe('handleFailureEvent — network-partition (Req 9.5)', () => {
    it('disables connection on inject', () => {
      const injector = new FailureInjector();
      const components = new Map<string, SimComponent>();
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'network-partition', connectionId: 'conn-1', triggerTime: 60, duration: 40 }],
        (e) => scheduled.push(e),
      );

      expect(injector.isConnectionDisabled('conn-1')).toBe(false);

      const injectEvent = scheduled.find((e) => e.kind === 'failure-inject')!;
      injector.handleFailureEvent(injectEvent, components);

      expect(injector.isConnectionDisabled('conn-1')).toBe(true);
    });

    it('re-enables connection on recover', () => {
      const injector = new FailureInjector();
      const components = new Map<string, SimComponent>();
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'network-partition', connectionId: 'conn-1', triggerTime: 60, duration: 40 }],
        (e) => scheduled.push(e),
      );

      const [inject, recover] = [
        scheduled.find((e) => e.kind === 'failure-inject')!,
        scheduled.find((e) => e.kind === 'failure-recover')!,
      ];

      injector.handleFailureEvent(inject, components);
      expect(injector.isConnectionDisabled('conn-1')).toBe(true);

      injector.handleFailureEvent(recover, components);
      expect(injector.isConnectionDisabled('conn-1')).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears disabled connections', () => {
      const injector = new FailureInjector();
      const components = new Map<string, SimComponent>();
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'network-partition', connectionId: 'conn-1', triggerTime: 0, duration: 100 }],
        (e) => scheduled.push(e),
      );

      const injectEvent = scheduled.find((e) => e.kind === 'failure-inject')!;
      injector.handleFailureEvent(injectEvent, components);
      expect(injector.isConnectionDisabled('conn-1')).toBe(true);

      injector.reset();
      expect(injector.isConnectionDisabled('conn-1')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty scenarios array', () => {
      const injector = new FailureInjector();
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures([], (e) => scheduled.push(e));
      expect(scheduled).toHaveLength(0);
    });

    it('ignores inject for non-existent component', () => {
      const injector = new FailureInjector();
      const components = new Map<string, SimComponent>();
      const scheduled: SimEvent[] = [];

      injector.scheduleFailures(
        [{ type: 'server-crash', targetId: 'missing-srv', triggerTime: 10, recoveryTime: 20 }],
        (e) => scheduled.push(e),
      );

      const injectEvent = scheduled.find((e) => e.kind === 'failure-inject')!;
      // Should not throw
      expect(() => injector.handleFailureEvent(injectEvent, components)).not.toThrow();
    });
  });
});
