import { ESTABLISH_CONNECTION, infoHash } from './constants.js';

export const getMessageToDial = () => ({
  infoHash,
  instruction: ESTABLISH_CONNECTION,
});

export const isValidInfoHash = (hash) => hash === infoHash;

export const handleNodeMessage = (data) => {
  console.log('In handleNodeMessage ', data);
  const { nodeId, infoHash } = data;
  if (!isValidInfoHash(infoHash)) {
    console.log('In valid node cannot process further instructions', nodeId);
    return;
  }
  // if (instruction === ESTABLISH_CONNECTION) {
  //   initiateChallenge()
  // }
};
