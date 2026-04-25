import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AboutDialog } from './components/AboutDialog';
import { findExampleById } from './examples';
import { loadExample } from './examples/load-example';
import { decodeScenario } from './persistence/url-codec';
import { validateScenario, loadScenarioIntoStores } from './components/SaveLoadButtons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Separator } from './components/ui/separator';
import { TooltipProvider } from './components/ui/tooltip';
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
        serviceTimeDistribution: { type: 'exponential', mean: 0.1 },
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
      return { type: 'queue', maxConcurrency: 10 };
    case 'throttle':
      return { type: 'throttle', mode: { type: 'concurrency', maxConcurrency: 10 } };
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

  const nodes: Node[] = useMemo(
    () =>
      components.map((c) => ({
        id: c.id,
        type: c.type,
        position: c.position,
        data: { label: c.label, notes: c.notes },
      })),
    [components],
  );

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

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const comps = useArchitectureStore.getState().components;
      const target = comps.find((c) => c.id === connection.target);
      const source = comps.find((c) => c.id === connection.source);
      if (!target || !source) return;

      if (target.type === 'client') return;
      if (source.type === 'database') return;
      if (source.type === 'queue') {
        const conns = useArchitectureStore.getState().connections;
        if (conns.some((c) => c.sourceId === source.id)) return;
      }

      addConnection({
        id: newId('conn'),
        sourceId: connection.source,
        targetId: connection.target,
      });
    },
    [addConnection],
  );

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
    <div className="flex-1 relative bg-[oklch(0.14_0.025_265)]" ref={reactFlowWrapper}>
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
  const [dashHeight, setDashHeight] = useState(220);
  const [urlLoadError, setUrlLoadError] = useState<string | null>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  // ?s= (shared scenario) takes priority over ?example=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('s');
    if (encoded) {
      decodeScenario(encoded)
        .then((raw) => {
          const scenario = validateScenario(raw);
          loadScenarioIntoStores(scenario);
        })
        .catch((err) => setUrlLoadError(err instanceof Error ? err.message : String(err)));
      return;
    }
    const exampleId = params.get('example');
    if (exampleId) {
      const example = findExampleById(exampleId);
      if (example) loadExample(example);
    }
  }, []);

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
    <TooltipProvider delayDuration={300}>
      <ReactFlowProvider>
        <div className="flex flex-col h-screen w-screen overflow-hidden text-foreground bg-background">
          {/* Top bar */}
          <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card flex-shrink-0 flex-nowrap min-w-0">
            <span className="font-semibold text-sm tracking-tight text-foreground whitespace-nowrap shrink-0 hidden sm:inline">
              Stability Sim
            </span>
            <ExamplesMenu />
            <Separator orientation="vertical" />
            <SimulationControls />
            <Separator orientation="vertical" />
            <SaveLoadButtons />
            <span className="flex-1" />
            <span className="text-[11px] text-muted-foreground whitespace-nowrap hidden xl:inline">
              by{' '}
              <a
                href="https://brooker.co.za/blog/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                Marc Brooker
              </a>
              {' · '}
              <a
                href="https://github.com/marcbrooker/stability-sim/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                GitHub
              </a>
            </span>
            <AboutDialog />
          </header>

          {/* Body */}
          <div className="flex flex-1 min-h-0">
            <aside className="w-48 bg-card border-r border-border flex-shrink-0 overflow-y-auto">
              <ComponentPalette />
            </aside>
            <FlowCanvas />
            <aside className="w-[340px] bg-card border-l border-border flex-shrink-0 overflow-y-auto flex flex-col">
              <PropertiesPanel />
              <FailureScenariosPanel />
            </aside>
          </div>

          {/* Resize handle */}
          <div
            className="h-1.5 bg-border hover:bg-accent cursor-ns-resize flex-shrink-0 transition-colors"
            onMouseDown={onDragStart}
          />

          {/* Dashboard */}
          <div
            className="bg-card border-t border-border flex-shrink-0 px-4 py-3 overflow-y-auto"
            style={{ height: dashHeight }}
          >
            <Dashboard />
          </div>
        </div>

        <Dialog open={!!urlLoadError} onOpenChange={(open) => !open && setUrlLoadError(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Failed to load shared scenario</DialogTitle>
              <DialogDescription className="text-destructive">
                {urlLoadError}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground italic">
              The shared URL may be corrupted, truncated, or from a newer version of the simulator.
            </p>
          </DialogContent>
        </Dialog>
      </ReactFlowProvider>
    </TooltipProvider>
  );
}

export default App;
