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
  byPeer: string;
  nodeEventId: string;
  logicalTime: number;
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

export interface PingDetails {
  type: string | null;
  logicalTime: number;
  replyCounter: number;
  deferCounter: number;
  stopExec: boolean;
  waitingForAck: boolean;
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
  pingDetails: PingDetails;
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
  (targetNode: string, type: string, logicalTime: number): Ping;
}

export interface customRejectError {
  reason: string;
  isMajorityAcknowledged: Function;
}

export const isCustomRejectError = (error: unknown): error is customRejectError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'reason' in error &&
    typeof (error as customRejectError).isMajorityAcknowledged === 'function'
  );
};
