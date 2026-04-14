import { useCallback, useState } from 'react';
import { EXAMPLES } from '../examples';
import { loadExample } from '../examples/load-example';
import type { Example } from '../examples';

/**
 * Dropdown menu for loading built-in example scenarios.
 * Loads both the architecture and simulation config (including failure scenarios)
 * into the respective stores, resetting any running simulation.
 */
export function ExamplesMenu() {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback((example: Example) => {
    loadExample(example);
    setOpen(false);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <button className="sim-btn" onClick={() => setOpen(!open)} title="Load an example scenario">
        Examples ▾
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 100,
              background: '#1e1e36',
              border: '1px solid #3a3a5a',
              borderRadius: 6,
              minWidth: 320,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              padding: 4,
              marginTop: 4,
            }}
          >
            {EXAMPLES.map((ex) => (
              <ExampleItem key={ex.id} example={ex} onSelect={handleSelect} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExampleItem({
  example,
  onSelect,
}: {
  example: Example;
  onSelect: (ex: Example) => void;
}) {
  return (
    <button
      className="example-item"
      onClick={() => onSelect(example)}
    >
      <div style={{ fontWeight: 600, fontSize: 13 }}>{example.name}</div>
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
        {example.description}
      </div>
    </button>
  );
}
