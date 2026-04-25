import {
  Database,
  Gauge,
  HardDrive,
  ListOrdered,
  Monitor,
  Network,
  Server,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from '../types';

/**
 * Single source of truth for the lucide icon + accent color used for each
 * component type. Used by the palette, canvas nodes, properties panel header,
 * and dashboard chips so the visual identity stays consistent.
 */
export interface ComponentVisual {
  icon: LucideIcon;
  color: string; // accent hex (also used for chart series)
  label: string;
}

export const COMPONENT_VISUALS: Record<ComponentType, ComponentVisual> = {
  client: { icon: Monitor, color: '#3b82f6', label: 'Client' },
  'load-balancer': { icon: Network, color: '#f59e0b', label: 'Load Balancer' },
  server: { icon: Server, color: '#f97316', label: 'Server' },
  cache: { icon: HardDrive, color: '#10b981', label: 'Cache' },
  database: { icon: Database, color: '#ef4444', label: 'Database' },
  queue: { icon: ListOrdered, color: '#a855f7', label: 'Queue' },
  throttle: { icon: Gauge, color: '#eab308', label: 'Throttle' },
};

/** Ordered list for palette display. */
export const COMPONENT_ORDER: ComponentType[] = [
  'client',
  'load-balancer',
  'server',
  'cache',
  'database',
  'queue',
  'throttle',
];
