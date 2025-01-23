import DHT from 'bittorrent-dht';

const PORT = 6881; // DHT default port
const infoHash = Buffer.from('decentralized-node-discovery');

const dht = new DHT({
  bootstrap: ['router.bittorrent.com:6881', 'router.utorrent.com:6881', 'dht.transmissionbt.com:6881'],
  retry: 5, // Number of retries for lookups
  concurrency: 16, // Number of concurrent queries
});

dht.listen(PORT, () => {
  console.log(`Node 1 listening on port ${PORT}`);
});

dht.announce(infoHash, PORT, () => {
  console.log(`Node 1 announced on DHT with infoHash: ${infoHash.toString('hex')}`);
});

dht.on('error', (err) => {
  console.log(`DHT has encountered fatal error: ${err}`);
});

// dht.on('node', (node) => {
//   console.log(`DHT has found a node: ${node}`);
// });

dht.on('warning', (err) => {
  console.log(`DHT has encountered warning error: ${err}`);
});
