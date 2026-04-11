import { v4 as uuidv4 } from 'uuid';
import type { SimEvent, WorkUnit } from '../types/events';
import type { SimComponent } from '../types/components';
import type { FailureScenario } from '../types/failures';
import { Server } from './components/server';
import { Database } from './components/database';
import { Cache } from './components/cache';

/**
 * Failure injector: converts FailureScenarios into timed SimEvents
 * and applies/removes failure effects on components.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */
export class FailureInjector {
  /** Set of currently disabled connection IDs (for network-partition) */
  private disabledConnections: Set<string> = new Set();

  /**
   * Convert each FailureScenario into a pair of SimEvents (inject + recover)
   * and schedule them via the provided callback.
   *
   * Req 9.1: Failure scenarios trigger at configured simulation time.
   */
  scheduleFailures(
    scenarios: FailureScenario[],
    scheduleEvent: (event: SimEvent) => void,
  ): void {
    for (const scenario of scenarios) {
      const injectEvent = this.createInjectEvent(scenario);
      scheduleEvent(injectEvent);

      // cache-flush is a one-shot event with no recovery
      if (scenario.type !== 'cache-flush') {
        const recoverEvent = this.createRecoverEvent(scenario);
        scheduleEvent(recoverEvent);
      }
    }
  }

  /**
   * Handle a failure-inject or failure-recover event by applying or
   * removing the failure effect on the target component.
   */
  handleFailureEvent(
    event: SimEvent,
    components: Map<string, SimComponent>,
  ): void {
    const metadata = event.workUnit.metadata;
    const failureType = metadata.failureType as string;

    if (event.kind === 'failure-inject') {
      this.applyFailure(failureType, metadata, components);
    } else if (event.kind === 'failure-recover') {
      this.removeFailure(failureType, metadata, components);
    }
  }

  /**
   * Check whether a connection is currently disabled by a network partition.
   * Req 9.5: network-partition disables a connection.
   */
  isConnectionDisabled(connectionId: string): boolean {
    return this.disabledConnections.has(connectionId);
  }

  /**
   * Check whether traffic between two components is blocked by a network partition.
   * Checks bidirectionally: a partition on connection A→B blocks both A→B and B→A traffic.
   */
  isPathBlocked(
    sourceId: string,
    targetId: string,
    connectionById: Map<string, { sourceId: string; targetId: string }>,
  ): boolean {
    for (const connId of this.disabledConnections) {
      const conn = connectionById.get(connId);
      if (!conn) continue;
      if ((conn.sourceId === sourceId && conn.targetId === targetId) ||
          (conn.sourceId === targetId && conn.targetId === sourceId)) {
        return true;
      }
    }
    return false;
  }

  /** Reset injector state */
  reset(): void {
    this.disabledConnections.clear();
  }

  // --- Private helpers ---

  private createInjectEvent(scenario: FailureScenario): SimEvent {
    const workUnit = this.createFailureWorkUnit(scenario, 'inject');
    return {
      id: uuidv4(),
      timestamp: scenario.triggerTime,
      targetComponentId: this.getTargetId(scenario),
      workUnit,
      kind: 'failure-inject',
    };
  }

  private createRecoverEvent(scenario: FailureScenario): SimEvent {
    const recoverTime = this.getRecoverTime(scenario);
    const workUnit = this.createFailureWorkUnit(scenario, 'recover');
    return {
      id: uuidv4(),
      timestamp: recoverTime,
      targetComponentId: this.getTargetId(scenario),
      workUnit,
      kind: 'failure-recover',
    };
  }

  private getTargetId(scenario: FailureScenario): string {
    if (scenario.type === 'network-partition') {
      return scenario.connectionId;
    }
    return scenario.targetId;
  }

  private getRecoverTime(scenario: FailureScenario): number {
    if (scenario.type === 'server-crash') {
      return scenario.recoveryTime;
    }
    if (scenario.type === 'cache-flush') {
      return scenario.triggerTime; // unused, but must return something
    }
    return scenario.triggerTime + scenario.duration;
  }

  private createFailureWorkUnit(
    scenario: FailureScenario,
    phase: 'inject' | 'recover',
  ): WorkUnit {
    return {
      id: uuidv4(),
      originClientId: '__failure-injector__',
      createdAt: scenario.triggerTime,
      key: `failure-${scenario.type}`,
      isRead: false,
      retryCount: 0,
      metadata: {
        failureType: scenario.type,
        phase,
        ...this.extractScenarioDetails(scenario),
      },
    };
  }

  private extractScenarioDetails(
    scenario: FailureScenario,
  ): Record<string, unknown> {
    switch (scenario.type) {
      case 'server-crash':
        return { targetId: scenario.targetId, recoveryTime: scenario.recoveryTime };
      case 'latency-spike':
        return { targetId: scenario.targetId, factor: scenario.factor, duration: scenario.duration };
      case 'cpu-reduction':
        return { targetId: scenario.targetId, reductionPercent: scenario.reductionPercent, duration: scenario.duration };
      case 'network-partition':
        return { connectionId: scenario.connectionId, duration: scenario.duration };
      case 'cache-flush':
        return { targetId: scenario.targetId };
    }
  }

  private applyFailure(
    failureType: string,
    metadata: Record<string, unknown>,
    components: Map<string, SimComponent>,
  ): void {
    switch (failureType) {
      case 'server-crash': {
        const comp = components.get(metadata.targetId as string);
        if (comp && comp instanceof Server) {
          comp.setCrashed(true);
        } else if (comp && comp instanceof Database) {
          comp.setCrashed(true);
        }
        break;
      }
      case 'latency-spike': {
        const comp = components.get(metadata.targetId as string);
        if (comp && comp instanceof Server) {
          comp.setLatencySpike(metadata.factor as number);
        } else if (comp && comp instanceof Database) {
          comp.setLatencySpike(metadata.factor as number);
        }
        break;
      }
      case 'cpu-reduction': {
        const server = components.get(metadata.targetId as string);
        if (server && server instanceof Server) {
          server.setCpuReduction(metadata.reductionPercent as number);
        }
        break;
      }
      case 'network-partition': {
        this.disabledConnections.add(metadata.connectionId as string);
        break;
      }
      case 'cache-flush': {
        const comp = components.get(metadata.targetId as string);
        if (comp && comp instanceof Cache) {
          comp.flush();
        }
        break;
      }
    }
  }

  private removeFailure(
    failureType: string,
    metadata: Record<string, unknown>,
    components: Map<string, SimComponent>,
  ): void {
    switch (failureType) {
      case 'server-crash': {
        const comp = components.get(metadata.targetId as string);
        if (comp && comp instanceof Server) {
          comp.setCrashed(false);
        } else if (comp && comp instanceof Database) {
          comp.setCrashed(false);
        }
        break;
      }
      case 'latency-spike': {
        const comp = components.get(metadata.targetId as string);
        if (comp && comp instanceof Server) {
          comp.setLatencySpike(1);
        } else if (comp && comp instanceof Database) {
          comp.setLatencySpike(1);
        }
        break;
      }
      case 'cpu-reduction': {
        const server = components.get(metadata.targetId as string);
        if (server && server instanceof Server) {
          server.setCpuReduction(0);
        }
        break;
      }
      case 'network-partition': {
        this.disabledConnections.delete(metadata.connectionId as string);
        break;
      }
    }
  }
}
