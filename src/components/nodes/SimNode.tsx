import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Copy, X } from 'lucide-react';
import { useArchitectureStore } from '../../stores/architecture-store';
import { useUIStore } from '../../stores/ui-store';

let cloneCounter = 0;

export function SimNode({
  id,
  data,
  emoji,
  defaultLabel,
  bg,
  border,
}: NodeProps & { emoji: string; defaultLabel: string; bg: string; border: string }) {
  const label = (data as { label?: string }).label ?? defaultLabel;
  const notes = (data as { notes?: string }).notes;

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    useArchitectureStore.getState().removeComponent(id);
    useUIStore.getState().selectComponent(null);
  };

  const onClone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const store = useArchitectureStore.getState();
    const comp = store.components.find((c) => c.id === id);
    if (!comp) return;
    const newId = `${comp.type}-clone-${Date.now()}-${++cloneCounter}`;
    store.addComponent({
      ...comp,
      id: newId,
      label: `${comp.label} (copy)`,
      position: { x: comp.position.x + 40, y: comp.position.y + 40 },
    });
  };

  return (
    <div
      className="sim-node group relative min-w-[120px] rounded-lg border-2 px-4 py-2.5 text-center text-white text-sm shadow-md transition-shadow hover:shadow-lg"
      style={{ background: bg, borderColor: border }}
    >
      <button
        className="sim-node-hover-btn absolute -top-2 -right-2 hidden h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-destructive hover:border-destructive hover:text-destructive-foreground"
        onClick={onDelete}
        title="Delete"
        aria-label="Delete"
      >
        <X className="h-3 w-3" strokeWidth={3} />
      </button>
      <button
        className="sim-node-hover-btn absolute -top-2 right-4 hidden h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-primary hover:border-primary hover:text-primary-foreground"
        onClick={onClone}
        title="Clone"
        aria-label="Clone"
      >
        <Copy className="h-3 w-3" strokeWidth={2.5} />
      </button>
      <div className="font-medium">
        <span className="mr-1">{emoji}</span>
        {label}
      </div>
      {notes && (
        <div className="mt-1 max-w-[150px] text-[10px] leading-snug text-white/60 break-words whitespace-normal">
          {notes}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
