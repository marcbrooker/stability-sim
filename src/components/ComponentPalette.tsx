import type { ComponentType } from '../types';
import { COMPONENT_VISUALS, COMPONENT_ORDER } from './component-icons';

export function ComponentPalette() {
  const onDragStart = (event: React.DragEvent, type: ComponentType, label: string) => {
    event.dataTransfer.setData('application/stabilitysim-type', type);
    event.dataTransfer.setData('application/stabilitysim-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex flex-col p-3 gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
        Components
      </div>
      <div className="flex flex-col gap-1">
        {COMPONENT_ORDER.map((type) => {
          const v = COMPONENT_VISUALS[type];
          const Icon = v.icon;
          return (
            <div
              key={type}
              className="group flex items-center gap-2.5 rounded-md border border-transparent bg-card px-2 py-1.5 text-sm font-medium text-foreground cursor-grab active:cursor-grabbing select-none transition-colors hover:border-border hover:bg-accent"
              draggable
              onDragStart={(e) => onDragStart(e, type, v.label)}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
                style={{ background: `${v.color}22`, color: v.color }}
              >
                <Icon className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span>{v.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
