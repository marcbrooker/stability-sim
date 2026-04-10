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
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, config } : c,
      ),
    })),

  addConnection: (connection) =>
    set((state) => ({ connections: [...state.connections, connection] })),

  removeConnection: (id) =>
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
    })),

  setArchitecture: (name, components, connections) =>
    set({ name, components, connections }),

  clear: () => set({ components: [], connections: [], name: '' }),
}));
