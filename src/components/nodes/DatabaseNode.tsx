import type { NodeProps } from '@xyflow/react';
import { SimNode } from './SimNode';

export function DatabaseNode(props: NodeProps) {
  return <SimNode {...props} emoji="🗄️" defaultLabel="Database" bg="#c0392b" border="#96281b" />;
}
