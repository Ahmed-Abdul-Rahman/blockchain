import { ESTABLISH_CONNECTION, infoHash } from './constants.js';

export const getMessageToDial = (node) => {
  const message = {
    nodeId: node.peerId.toString(),
    infoHash,
    instruction: ESTABLISH_CONNECTION,
  };
  return JSON.stringify(message);
};

export const isValidInfoHash = (hash) => hash === infoHash;
