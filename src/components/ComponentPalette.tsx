import type { ComponentType } from '../types';

interface PaletteItem {
  type: ComponentType;
  label: string;
  emoji: string;
  color: string;
}

const paletteItems: PaletteItem[] = [
  { type: 'client', label: 'Client', emoji: '🖥️', color: '#4a90d9' },
  { type: 'load-balancer', label: 'Load Balancer', emoji: '⚖️', color: '#f39c12' },
  { type: 'server', label: 'Server', emoji: '⚙️', color: '#e07b39' },
  { type: 'cache', label: 'Cache', emoji: '💾', color: '#27ae60' },
  { type: 'database', label: 'Database', emoji: '🗄️', color: '#c0392b' },
  { type: 'queue', label: 'Queue', emoji: '📋', color: '#8e44ad' },
];

const containerStyle: React.CSSProperties = {
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const headerStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 4,
  color: '#fff',
};

function itemStyle(color: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: color,
    color: '#fff',
    borderRadius: 6,
    cursor: 'grab',
    fontSize: 13,
    fontWeight: 500,
    userSelect: 'none',
  };
}

export function ComponentPalette() {
  const onDragStart = (event: React.DragEvent, item: PaletteItem) => {
    event.dataTransfer.setData('application/stabilitysim-type', item.type);
    event.dataTransfer.setData('application/stabilitysim-label', item.label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>Components</div>
      {paletteItems.map((item) => (
        <div
          key={item.type}
          style={itemStyle(item.color)}
          draggable
          onDragStart={(e) => onDragStart(e, item)}
        >
          <span>{item.emoji}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
