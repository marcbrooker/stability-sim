import type { NodeProps } from '@xyflow/react';
import { SimNode } from './SimNode';

export function ClientNode(props: NodeProps) {
  return <SimNode {...props} emoji="🖥️" defaultLabel="Client" bg="#4a90d9" border="#2a6cb0" />;
}
