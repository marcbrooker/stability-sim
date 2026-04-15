import { ClientNode } from './ClientNode';
import { ServerNode } from './ServerNode';
import { QueueNode } from './QueueNode';
import { CacheNode } from './CacheNode';
import { LoadBalancerNode } from './LoadBalancerNode';
import { DatabaseNode } from './DatabaseNode';
import { ThrottleNode } from './ThrottleNode';
import type { NodeTypes } from '@xyflow/react';

export const nodeTypes: NodeTypes = {
  client: ClientNode,
  server: ServerNode,
  queue: QueueNode,
  cache: CacheNode,
  'load-balancer': LoadBalancerNode,
  database: DatabaseNode,
  throttle: ThrottleNode,
};
