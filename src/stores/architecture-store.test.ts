import { describe, it, expect, beforeEach } from 'vitest';
import { useArchitectureStore } from './architecture-store';
import type { ComponentDefinition, ConnectionDefinition } from '../types';

const makeComponent = (id: string, type: 'server' | 'client' = 'server'): ComponentDefinition => ({
  id,
  type,
  label: id,
  position: { x: 0, y: 0 },
  config: type === 'server'
    ? { type: 'server', serviceTimeDistribution: { type: 'exponential', mean: 10 }, concurrencyLimit: 4 }
    : { type: 'client', trafficPattern: { type: 'open-loop', meanArrivalRate: 100 }, retryStrategy: { type: 'none' }, targetComponentId: '' },
});

const makeConnection = (id: string, sourceId: string, targetId: string): ConnectionDefinition => ({
  id, sourceId, targetId,
});

describe('useArchitectureStore', () => {
  beforeEach(() => {
    useArchitectureStore.getState().clear();
  });

  it('starts empty', () => {
    const s = useArchitectureStore.getState();
    expect(s.components).toEqual([]);
    expect(s.connections).toEqual([]);
    expect(s.name).toBe('');
  });

  it('addComponent appends a component', () => {
    const c = makeComponent('s1');
    useArchitectureStore.getState().addComponent(c);
    expect(useArchitectureStore.getState().components).toEqual([c]);
  });

  it('removeComponent removes the component and attached connections', () => {
    const s1 = makeComponent('s1');
    const s2 = makeComponent('s2');
    const conn = makeConnection('c1', 's1', 's2');

    const store = useArchitectureStore.getState();
    store.addComponent(s1);
    store.addComponent(s2);
    store.addConnection(conn);

    useArchitectureStore.getState().removeComponent('s1');
    const state = useArchitectureStore.getState();
    expect(state.components).toEqual([s2]);
    expect(state.connections).toEqual([]);
  });

  it('updateComponentConfig updates the config of a specific component', () => {
    const c = makeComponent('s1');
    useArchitectureStore.getState().addComponent(c);

    const newConfig = { type: 'server' as const, serviceTimeDistribution: { type: 'uniform' as const, min: 1, max: 5 }, concurrencyLimit: 8 };
    useArchitectureStore.getState().updateComponentConfig('s1', newConfig);

    expect(useArchitectureStore.getState().components[0].config).toEqual(newConfig);
  });

  it('addConnection and removeConnection', () => {
    const conn = makeConnection('c1', 's1', 's2');
    useArchitectureStore.getState().addConnection(conn);
    expect(useArchitectureStore.getState().connections).toEqual([conn]);

    useArchitectureStore.getState().removeConnection('c1');
    expect(useArchitectureStore.getState().connections).toEqual([]);
  });

  it('setArchitecture replaces all state', () => {
    const comps = [makeComponent('a'), makeComponent('b')];
    const conns = [makeConnection('c1', 'a', 'b')];
    useArchitectureStore.getState().setArchitecture('My Arch', comps, conns);

    const s = useArchitectureStore.getState();
    expect(s.name).toBe('My Arch');
    expect(s.components).toEqual(comps);
    expect(s.connections).toEqual(conns);
  });

  it('clear resets everything', () => {
    useArchitectureStore.getState().addComponent(makeComponent('s1'));
    useArchitectureStore.getState().clear();
    const s = useArchitectureStore.getState();
    expect(s.components).toEqual([]);
    expect(s.connections).toEqual([]);
    expect(s.name).toBe('');
  });
});
