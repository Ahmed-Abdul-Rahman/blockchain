export interface NetworkNodeConfig {
  nodeEventId: string;
  networkId: string;
  infoHash: string;
  genesisTimestamp: number;
}

export interface Ping {
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
