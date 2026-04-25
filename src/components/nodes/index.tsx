import type { NodeProps, NodeTypes } from '@xyflow/react';
import { COMPONENT_VISUALS } from '../component-icons';
import type { ComponentType } from '../../types';
import { SimNode } from './SimNode';

function makeNode(type: ComponentType) {
  const v = COMPONENT_VISUALS[type];
  return function NodeRenderer(props: NodeProps) {
    return <SimNode {...props} Icon={v.icon} defaultLabel={v.label} accent={v.color} />;
  };
}

export const nodeTypes: NodeTypes = {
  client: makeNode('client'),
  server: makeNode('server'),
  queue: makeNode('queue'),
  cache: makeNode('cache'),
  'load-balancer': makeNode('load-balancer'),
  database: makeNode('database'),
  throttle: makeNode('throttle'),
};
