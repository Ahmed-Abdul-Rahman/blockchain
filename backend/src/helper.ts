import { ESTABLISH_CONNECTION, infoHash } from './constants.js';

export const getMessageToDial = (): object => ({
  infoHash,
  instruction: ESTABLISH_CONNECTION,
});

export const isValidInfoHash = (hash: string): boolean => hash === infoHash;

export const handleNodeMessage = (data: { nodeId: string; infoHash: string }): void => {
  console.log('In handleNodeMessage ', data);
  const { nodeId, infoHash } = data;
  if (!isValidInfoHash(infoHash)) {
    console.log('In valid node cannot process further instructions', nodeId);
    return;
  }
};
