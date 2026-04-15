import type { NodeProps } from '@xyflow/react';
import { SimNode } from './SimNode';

export function ThrottleNode(props: NodeProps) {
  return <SimNode {...props} emoji="🚦" defaultLabel="Throttle" bg="#e67e22" border="#c0651a" />;
}
