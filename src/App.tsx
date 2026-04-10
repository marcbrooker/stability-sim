import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnConnect,
  type Connection,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';

import { useArchitectureStore } from './stores/architecture-store';
import { useUIStore } from './stores/ui-store';
import { nodeTypes } from './components/nodes';
import { ComponentPalette } from './components/ComponentPalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { FailureScenariosPanel } from './components/FailureScenariosPanel';
import { SimulationControls } from './components/SimulationControls';
import { SaveLoadButtons } from './components/SaveLoadButtons';
import { ExamplesMenu } from './components/ExamplesMenu';
import { Dashboard } from './components/Dashboard';
import type { ComponentConfig, ComponentType } from './types';

/** Generate a simple unique id */
let idCounter = 0;
function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

function defaultConfig(type: ComponentType): ComponentConfig {
  switch (type) {
    case 'client':
      return {
        type: 'client',
        trafficPattern: { type: 'open-loop', meanArrivalRate: 100 },
        retryStrategy: { type: 'none' },
        targetComponentId: '',
        timeout: 1,
      };
    case 'server':
      return {
        type: 'server',
        serviceTimeDistribution: { type: 'exponential', mean: 0.005 },
        concurrencyLimit: 10,
      };
    case 'database':
      return {
        type: 'database',
        readLatencyDistribution: { type: 'exponential', mean: 0.005 },
        writeLatencyDistribution: { type: 'exponential', mean: 0.01 },
        connectionPoolSize: 20,
      };
    case 'cache':
      return { type: 'cache', hitRate: 0.8, downstreamComponentId: '', ttl: 10, maxSize: 1000, evictionPolicy: 'lru' as const };
    case 'load-balancer':
      return { type: 'load-balancer', strategy: 'round-robin' };
    case 'queue':
      return { type: 'queue', maxCapacity: 1000 };
  }
}

/** Generate a unique label like "Server A", "Server B", etc. */
function nextLabel(label: string, existingComponents: { label: string }[]): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const letter of letters) {
    const candidate = `${label} ${letter}`;
    if (!existingComponents.some((c) => c.label === candidate)) {
      return candidate;
    }
  }
  return `${label} ${Date.now()}`;
}

function FlowCanvas() {
  const components = useArchitectureStore((s) => s.components);
  const connections = useArchitectureStore((s) => s.connections);
  const addComponent = useArchitectureStore((s) => s.addComponent);
  const addConnection = useArchitectureStore((s) => s.addConnection);
  const selectComponent = useUIStore((s) => s.selectComponent);
  const selectConnection = useUIStore((s) => s.selectConnection);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Convert store components to React Flow nodes
  const nodes: Node[] = useMemo(
    () =>
      components.map((c) => ({
        id: c.id,
        type: c.type,
        position: c.position,
        data: { label: c.label },
      })),
    [components],
  );

  // Convert store connections to React Flow edges
  const edges: Edge[] = useMemo(
    () =>
      connections.map((c) => ({
        id: c.id,
        source: c.sourceId,
        target: c.targetId,
        animated: true,
      })),
    [connections],
  );

  // Handle node position changes (drag)
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const positionChanges = changes.filter(
        (c): c is Extract<typeof c, { type: 'position' }> =>
          c.type === 'position' && !!c.position,
      );
      if (positionChanges.length === 0) return;

      useArchitectureStore.setState((state) => ({
        components: state.components.map((comp) => {
          const change = positionChanges.find((c) => c.id === comp.id);
          return change ? { ...comp, position: change.position! } : comp;
        }),
      }));
    },
    [],
  );

  // Handle new connections — validate that the connection makes sense
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const comps = useArchitectureStore.getState().components;
      const target = comps.find((c) => c.id === connection.target);
      const source = comps.find((c) => c.id === connection.source);
      if (!target || !source) return;

      // Clients don't accept incoming connections
      if (target.type === 'client') return;
      // Databases are terminal — can't be a source
      if (source.type === 'database') return;

      addConnection({
        id: newId('conn'),
        sourceId: connection.source,
        targetId: connection.target,
      });
    },
    [addConnection],
  );

  // Handle drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/stabilitysim-type') as ComponentType;
      const label = event.dataTransfer.getData('application/stabilitysim-label');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const components = useArchitectureStore.getState().components;

      addComponent({
        id: newId(type),
        type,
        label: nextLabel(label || type, components),
        position,
        config: defaultConfig(type),
      });
    },
    [addComponent, screenToFlowPosition],
  );

  return (
    <div className="app-canvas" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={(_event, node) => selectComponent(node.id)}
        onEdgeClick={(_event, edge) => selectConnection(edge.id)}
        onPaneClick={() => {
          selectComponent(null);
          selectConnection(null);
        }}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function App() {
  const [dashHeight, setDashHeight] = useState(200);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = dashHeight;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - ev.clientY;
      setDashHeight(Math.max(100, Math.min(window.innerHeight * 0.7, startH.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [dashHeight]);

  return (
    <ReactFlowProvider>
      <div className="app-layout">
        <div className="app-topbar">
          <span className="app-topbar-title">Stability Sim</span>
          <ExamplesMenu />
          <span className="sep" />
          <SimulationControls />
          <span className="sep" />
          <SaveLoadButtons />
        </div>
        <div className="app-body">
          <div className="app-sidebar-left">
            <ComponentPalette />
          </div>
          <FlowCanvas />
          <div className="app-sidebar-right">
            <PropertiesPanel />
            <FailureScenariosPanel />
          </div>
        </div>
        <div
          className="app-dashboard-resize-handle"
          onMouseDown={onDragStart}
        />
        <div className="app-dashboard" style={{ height: dashHeight }}><Dashboard /></div>
      </div>
    </ReactFlowProvider>
  );
}

export default App;
