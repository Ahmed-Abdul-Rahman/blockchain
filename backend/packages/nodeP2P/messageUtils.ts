import { generateTimestamp } from '@common/utils';
import { ACTIVE, ANNOUNCE_PRESENCE, ANNOUNCE_PRESENCE_RES, INFO_HASH_EXG, NTWK_DATA_EXG } from './messageTypes';
import { NetworkNode } from './NetworkNode';
import { Ping } from './types';

export interface MessageUtility {
  getAnnounceMesg: () => object;
  getAnnounceMesgRes: () => object;
  getInfoHashMesg: () => object;
  getNetworkExgMesg: () => object;
  getPingMesg: () => Ping;
}

export function setupMessageUtility(context: NetworkNode): MessageUtility {
  return {
    getAnnounceMesg(): object {
      return {
        type: ANNOUNCE_PRESENCE,
        fromNode: context.nodeId?.toString(),
        nodeData: {
          nodePeerId: context.nodeId?.toString(),
          nodeAddress: context.nodeAddress,
          port: process.env.SERVER_PORT,
          status: ACTIVE,
        },
      };
    },
    getAnnounceMesgRes(): object {
      return {
        type: ANNOUNCE_PRESENCE_RES,
        fromNode: context.nodeId?.toString(),
        nodeData: {
          nodePeerId: context.nodeId?.toString(),
          nodeAddress: context.nodeAddress,
          port: process.env.SERVER_PORT,
          status: ACTIVE,
        },
      };
    },
    getInfoHashMesg(): object {
      return {
        infoHash: context.infoHash,
        nodeEventId: context.nodeEventId,
        nodeId: context.nodeId,
        stage: INFO_HASH_EXG,
        timestamp: generateTimestamp(),
      };
    },
    getNetworkExgMesg(): object {
      return {
        connectedNodesCount: context.nodeStore.getSize(),
        nodeAddress: context.nodeAddress,
        port: process.env.SERVER_PORT,
        nodeId: context.nodeId,
        stage: NTWK_DATA_EXG,
        timestamp: generateTimestamp(),
      };
    },
    getPingMesg(type: string = 'PING', status: string = 'NA'): Ping {
      return {
        type,
        status,
        fromNode: context.nodeId?.toString() as string,
        timestamp: Date.now(),
      };
    },
  };
}
