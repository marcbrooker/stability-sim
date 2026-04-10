import type { NodeProps } from '@xyflow/react';
import { SimNode } from './SimNode';

export function CacheNode(props: NodeProps) {
  return <SimNode {...props} emoji="💾" defaultLabel="Cache" bg="#27ae60" border="#1e8449" />;
}
