import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useArchitectureStore } from '../../stores/architecture-store';
import { useUIStore } from '../../stores/ui-store';

const hoverBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: -8,
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: '#2a2a4a',
  border: '1.5px solid #3a3a5a',
  color: '#8888aa',
  fontSize: 10,
  cursor: 'pointer',
  padding: 0,
  display: 'none',
  lineHeight: 1,
  alignItems: 'center',
  justifyContent: 'center',
};

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
      className="sim-node"
      style={{
        background: bg,
        color: '#fff',
        padding: '10px 16px',
        borderRadius: 8,
        border: `2px solid ${border}`,
        minWidth: 120,
        textAlign: 'center',
        fontSize: 13,
        position: 'relative',
      }}
    >
      <button
        className="sim-node-hover-btn"
        style={{ ...hoverBtnStyle, right: -8 }}
        onClick={onDelete}
        title="Delete"
      >
        ✕
      </button>
      <button
        className="sim-node-hover-btn sim-node-clone"
        style={{ ...hoverBtnStyle, right: 16 }}
        onClick={onClone}
        title="Clone"
      >
        ⧉
      </button>
      <div>{emoji} {label}</div>
      {notes && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 3, lineHeight: 1.3, maxWidth: 150, wordWrap: 'break-word', whiteSpace: 'normal' }}>
          {notes}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
