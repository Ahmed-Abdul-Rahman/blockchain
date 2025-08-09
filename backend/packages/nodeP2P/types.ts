import { KeyObject } from 'crypto';

export interface NetworkNodeConfig {
  nodeEventId: string;
  nodePrivateKey: KeyObject;
  nodePublicKey: KeyObject;
  networkId: string;
  infoHash: string;
  genesisTimestamp: number;
}

export interface Ping extends Record<string, unknown> {
  type: string;
  status: string;
  fromNode: string;
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
  nodePeerId: string;
  nodeAddress: string;
  port: number;
  status: string;
  timeline?: string[];
  isDialer?: string | null;
  handlerProtocol?: string;
  lastUpdated: number;
}

export interface NodesStore extends Map<string, NodeObject> {}

export const isNodeObjectType = (obj: unknown | NodeObject): boolean | undefined => {
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
    (obj as NodeObject).timeline?.every((item) => typeof item === 'string')
  );
};
