import bitcoin from './blockchain.js';
import DHT from 'bittorrent-dht';

export const startDHT = (port, infoHashSeed, publicKey, onNodeDiscovery) => {
  const infoHash = Buffer.from(infoHashSeed); // Unique identifier for this network

  const dht = new DHT();

  dht.listen(port, () => {
    console.log(`DHT node listening on port ${port}`);
  });

  // Announce the current node
  dht.announce(infoHash, port, async () => {
    console.log(`Announced on DHT with infoHash ${infoHash.toString('hex')}`);
  });

  // Look for other nodes in the network
  dht.lookup(infoHash);

  // Handle discovered nodes
  dht.on('peer', (peerNode) => {
    const nodeAddress = `http://${peerNode.host}:${peerNode.port}`;
    if (bitcoin.networkNodes.findIndex(nodeAddress) === -1) {
      console.log(`Discovered node: ${nodeAddress}`);
      onNodeDiscovery(nodeAddress, publicKey);
    }
  });

  dht.on('error', (err) => {
    console.log(`DHT has encountered fatal error: ${err}`);
  });

  dht.on('warning', (err) => {
    console.log(`DHT has encountered warning error: ${err}`);
  });
};
