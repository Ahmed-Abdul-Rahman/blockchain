import { PeerId } from '@libp2p/interface';

export interface NetworkNodeConfig {
  nodeEventId: string;
  networkId: string;
  infoHash: string;
  getNodesCount: Function;
}

export interface Ping {
  type: string;
  targetNode: string;
  status: string;
  byPeer: string;
  timestamp: number;
}

export interface StreamMessage {
  infoHash?: string;
  nodeId: string;
  nodeEventId?: string;
  stage?: string;
  nodeAddress?: string;
  port?: string | number;
  connectedNodesCount?: number;
  timestamp: string;
}

export interface NodeObject {
  nodePeerId: PeerId;
  nodeAddress: string;
  port?: number;
  timeline: string[];
  status: string;
  isDialer?: string | null;
  handlerProtocol?: string;
  lastUpdated: number;
  requestStatus: string;
  requestTimestamp: number | null;
}

export interface NodesStore extends Map<string, NodeObject> {}

export const isNodeObjectType = (obj: unknown | NodeObject): boolean => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'nodeAddress' in obj &&
    'port' in obj &&
    'status' in obj &&
    'timeline' in obj &&
    Array.isArray((obj as NodeObject).timeline) &&
    typeof (obj as NodeObject).nodeAddress === 'string' &&
    typeof (obj as NodeObject).port === 'number' &&
    typeof (obj as NodeObject).status === 'string' &&
    (obj as NodeObject).timeline.every((item) => typeof item === 'string')
  );
};

export interface genericFunc {
  (...args: unknown[]): void;
}

export interface pingFunc {
  (targetNode: string, type?: string, status?: string): Ping;
}
