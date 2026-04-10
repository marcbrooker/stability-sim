import type { Architecture } from './models';
import type { SimulationConfig } from './models';
import type { MetricSnapshot } from './metrics';

/** Messages sent from the main thread to the simulation worker */
export type MainToWorker =
  | { type: 'start'; architecture: Architecture; config: SimulationConfig; seed: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step' }
  | { type: 'reset' }
  | { type: 'setSpeed'; multiplier: number };

/** Messages sent from the simulation worker to the main thread */
export type WorkerToMain =
  | { type: 'metrics'; snapshot: MetricSnapshot }
  | { type: 'completed' }
  | { type: 'paused'; simTime: number }
  | { type: 'error'; message: string };
