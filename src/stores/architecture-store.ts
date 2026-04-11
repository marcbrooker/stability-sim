import { create } from 'zustand';
import type { ComponentDefinition, ConnectionDefinition, ComponentConfig } from '../types';

interface ArchitectureState {
  components: ComponentDefinition[];
  connections: ConnectionDefinition[];
  name: string;

  addComponent: (component: ComponentDefinition) => void;
  removeComponent: (id: string) => void;
  updateComponentConfig: (id: string, config: ComponentConfig) => void;
  addConnection: (connection: ConnectionDefinition) => void;
  removeConnection: (id: string) => void;
  setArchitecture: (name: string, components: ComponentDefinition[], connections: ConnectionDefinition[]) => void;
  clear: () => void;
}

export const useArchitectureStore = create<ArchitectureState>((set) => ({
  components: [],
  connections: [],
  name: '',

  addComponent: (component) =>
    set((state) => ({ components: [...state.components, component] })),

  removeComponent: (id) =>
    set((state) => ({
      components: state.components.filter((c) => c.id !== id),
      connections: state.connections.filter(
        (conn) => conn.sourceId !== id && conn.targetId !== id,
      ),
    })),

  updateComponentConfig: (id, config) =>
    set((state) => {
      const components = state.components.map((c) =>
        c.id === id ? { ...c, config } : c,
      );
      // Propagate server concurrencyLimit to upstream queue's maxConcurrency
      if (config.type === 'server') {
        const upstreamQueueConns = state.connections.filter((c) => c.targetId === id);
        for (const conn of upstreamQueueConns) {
          const idx = components.findIndex((c) => c.id === conn.sourceId && c.config.type === 'queue');
          if (idx !== -1) {
            const qc = components[idx].config;
            if (qc.type === 'queue') {
              components[idx] = {
                ...components[idx],
                config: { ...qc, maxConcurrency: config.concurrencyLimit },
              };
            }
          }
        }
      }
      return { components };
    }),

  addConnection: (connection) =>
    set((state) => {
      const components = [...state.components];
      const source = components.find((c) => c.id === connection.sourceId);
      const target = components.find((c) => c.id === connection.targetId);
      // When connecting queue → server, sync maxConcurrency
      if (source && source.config.type === 'queue' && target && target.config.type === 'server') {
        const idx = components.indexOf(source);
        components[idx] = {
          ...source,
          config: { ...source.config, maxConcurrency: target.config.concurrencyLimit },
        };
      }
      return { connections: [...state.connections, connection], components };
    }),

  removeConnection: (id) =>
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
    })),

  setArchitecture: (name, components, connections) =>
    set({ name, components, connections }),

  clear: () => set({ components: [], connections: [], name: '' }),
}));
