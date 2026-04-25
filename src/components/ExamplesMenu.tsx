import { useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { EXAMPLES } from '../examples';
import { loadExample } from '../examples/load-example';
import type { Example } from '../examples';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/**
 * Dropdown menu for loading built-in example scenarios.
 * Loads both the architecture and simulation config (including failure scenarios)
 * into the respective stores, resetting any running simulation.
 */
export function ExamplesMenu() {
  const handleSelect = useCallback((example: Example) => {
    loadExample(example);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Load an example scenario">
          Examples
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[320px]">
        {EXAMPLES.map((ex) => (
          <DropdownMenuItem key={ex.id} onSelect={() => handleSelect(ex)}>
            <span className="text-sm font-semibold text-foreground">{ex.name}</span>
            <span className="text-[11px] text-muted-foreground leading-snug">
              {ex.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
