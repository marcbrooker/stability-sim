import type { NodeProps } from '@xyflow/react';
import { SimNode } from './SimNode';

export function QueueNode(props: NodeProps) {
  return <SimNode {...props} emoji="📋" defaultLabel="Queue" bg="#8e44ad" border="#6c3483" />;
}
