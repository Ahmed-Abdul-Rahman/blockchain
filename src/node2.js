import DHT from 'bittorrent-dht';
import upnp from 'nat-upnp';
const client = upnp.createClient();

function startDHT() {
  const dht = new DHT({
    bootstrap: ['router.bittorrent.com:6881', 'router.utorrent.com:6881', 'dht.transmissionbt.com:6881'],
    retry: 5, // Number of retries for lookups
    concurrency: 16, // Number of concurrent queries
  });
  const infoHash = Buffer.from('decentralized-node-discovery');

  dht.listen(6882, () => {
    console.log('Node 2 listening on port 6882');
  });

  dht.on('peer', (peer) => {
    console.log(`Discovered peer: ${peer.host}:${peer.port}`);
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

  dht.lookup(infoHash); // Start looking for peers
}

client.portMapping(
  {
    public: 6882,
    private: 6882,
    ttl: 3600,
  },
  (err) => {
    if (err) {
      console.error('UPnP error:', err);
    } else {
      console.log('Port forwarded successfully using UPnP');
      startDHT();
    }
  },
);
