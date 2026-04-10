import type { NodeProps } from '@xyflow/react';
import { SimNode } from './SimNode';

export function LoadBalancerNode(props: NodeProps) {
  return <SimNode {...props} emoji="⚖️" defaultLabel="Load Balancer" bg="#f39c12" border="#d68910" />;
}
