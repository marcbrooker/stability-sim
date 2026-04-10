/** Kinds of simulation events */
export type EventKind =
  | 'arrival'         // work unit arriving at a component
  | 'departure'       // work unit finished processing
  | 'failure-inject'  // failure scenario trigger
  | 'failure-recover' // failure scenario recovery
  | 'timeout';        // work unit timed out

/** A unit of work flowing through the system */
export interface WorkUnit {
  id: string;
  originClientId: string;
  createdAt: number;
  key: string;
  isRead: boolean;
  retryCount: number;
  metadata: Record<string, unknown>;
}

/** A simulation event to be processed */
export interface SimEvent {
  id: string;
  timestamp: number;
  targetComponentId: string;
  workUnit: WorkUnit;
  kind: EventKind;
}
