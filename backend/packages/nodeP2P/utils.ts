import { Ping } from './dataTypes';
import { NetworkNode } from './NetworkNode';

export function getPingMesg(
  this: NetworkNode,
  targetNode: string,
  type: string = 'PING',
  status: string = 'LOCKED',
): Ping {
  return {
    type,
    targetNode,
    status,
    byPeer: this.nodeId?.toString() as string,
    timestamp: Date.now(),
  };
}
