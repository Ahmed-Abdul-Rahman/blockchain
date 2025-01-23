import axios from 'axios';
import { verifySignature } from './cryptoUtils.js';
// import { REGISTER_AND_BROADCAST_NODE } from './constants';
import bitcoin from './blockchain.js';
import crypto from 'crypto';

export const initiateChallenge = async (nodeAddress, publicKey) => {
  const challenge = crypto.randomBytes(32).toString('hex');
  try {
    const response = await axios.post(`${nodeAddress}/challenge`, {
      challenge,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    });

    // Verify the challenge response
    const isValid = verifySignature(challenge, response.data.response, response.data.publicKey);
    if (isValid) {
      console.log(`Verified node: ${nodeAddress}`);
      //   networkNodes.set(nodeAddress, response.data.publicKey);
      //   const requestOptions = {
      //     method: 'post',
      //     url: nodeAddress + REGISTER_AND_BROADCAST_NODE,
      //     data: { newNodeUrl: bitcoin.currentNode },
      //   };
      //   axios(requestOptions);
      return true;
    } else {
      console.error(`Invalid response from node: ${nodeAddress}`);
      return false;
    }
  } catch (error) {
    console.error(`Failed to verify node: ${nodeAddress} - ${error.message}`);
    return false;
  }
};

export const startDHT = (dht, port, infoHashSeed, publicKey, onNodeDiscovery) => {
  const infoHash = Buffer.from(infoHashSeed); // Unique identifier for this network

  dht.listen(port, () => {
    console.log(`DHT node listening on port ${port}`);
  });

  // Announce the current node
  dht.announce(infoHash, port, async () => {
    console.log(`Announced on DHT with infoHash ${infoHash.toString('hex')}`);
  });

  // Look for other nodes in the network
  setInterval(() => {
    console.log('DHT Lookup');
    dht.lookup(infoHash);
  }, 60000);
  dht.lookup(infoHash);

  // Handle discovered nodes
  dht.on('peer', (peerNode) => {
    const nodeAddress = `https://${peerNode.host}:${peerNode.port}`;
    if (bitcoin.networkNodes.findIndex(nodeAddress) === -1) {
      console.log(`Discovered node: ${nodeAddress}`);
      onNodeDiscovery(nodeAddress, publicKey);
    }
  });
};
