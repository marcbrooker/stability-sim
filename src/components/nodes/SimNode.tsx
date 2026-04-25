import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Copy, X, type LucideIcon } from 'lucide-react';
import { useArchitectureStore } from '../../stores/architecture-store';
import { useUIStore } from '../../stores/ui-store';

let cloneCounter = 0;

export function SimNode({
  id,
  data,
  Icon,
  defaultLabel,
  accent,
}: NodeProps & { Icon: LucideIcon; defaultLabel: string; accent: string }) {
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
      className="sim-node group relative flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-sm transition-shadow hover:shadow-md min-w-[140px]"
      style={{ borderColor: `${accent}55` }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{ background: `${accent}22`, color: accent }}
      >
        <Icon className="h-4 w-4" strokeWidth={2.25} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground leading-tight truncate">{label}</div>
        {notes && (
          <div className="text-[10px] leading-snug text-muted-foreground truncate">{notes}</div>
        )}
      </div>
      <button
        className="sim-node-hover-btn pointer-events-none absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity hover:bg-destructive hover:border-destructive hover:text-destructive-foreground"
        onClick={onDelete}
        title="Delete"
        aria-label="Delete"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
      <button
        className="sim-node-hover-btn pointer-events-none absolute -top-2 right-4 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity hover:bg-primary hover:border-primary hover:text-primary-foreground"
        onClick={onClone}
        title="Clone"
        aria-label="Clone"
      >
        <Copy className="h-3 w-3" strokeWidth={2.25} />
      </button>
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
