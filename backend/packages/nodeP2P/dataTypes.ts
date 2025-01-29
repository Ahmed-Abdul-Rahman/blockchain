import { PeerId } from '@libp2p/interface';

export interface NetworkNodeConfig {
  nodeEventId: string;
  networkId: string;
  infoHash: string;
  getNodesCount: Function;
}

export interface Ping {
  targetNode: string;
  status: string;
  byPeer: string | null;
  timestamp: string;
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
  nodePeerId?: PeerId;
  nodeAddress: string;
  port?: number;
  timeline: string[];
  status: string;
  isHandler?: string | null;
  handlerProtocol?: string;
  lastUpdated: number;
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
