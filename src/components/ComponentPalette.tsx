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
  { type: 'throttle', label: 'Throttle', emoji: '🚦', color: '#e67e22' },
];

export function ComponentPalette() {
  const onDragStart = (event: React.DragEvent, item: PaletteItem) => {
    event.dataTransfer.setData('application/stabilitysim-type', item.type);
    event.dataTransfer.setData('application/stabilitysim-label', item.label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
        Components
      </div>
      {paletteItems.map((item) => (
        <div
          key={item.type}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-white text-sm font-medium cursor-grab active:cursor-grabbing select-none transition-transform hover:translate-x-0.5 hover:shadow-md"
          style={{ background: item.color }}
          draggable
          onDragStart={(e) => onDragStart(e, item)}
        >
          <span className="text-base leading-none">{item.emoji}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
