import type { NodeProps } from '@xyflow/react';
import { SimNode } from './SimNode';

export function ServerNode(props: NodeProps) {
  return <SimNode {...props} emoji="⚙️" defaultLabel="Server" bg="#e07b39" border="#b85e1f" />;
}
