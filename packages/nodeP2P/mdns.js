import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mdns } from '@libp2p/mdns';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';

const createNode = async () => {
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0'], // Listen on a random available port
    },
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      mdns({
        interval: 10000, // Query interval in milliseconds
      }),
    ],
  });

  node.addEventListener('peer:discovery', (evt) => {
    const peerId = evt.detail.id;
    console.log(`Discovered peer: ${peerId.toString()}`);
    console.log('Multiaddrs:', evt.detail.multiaddrs);
    // Attempt to dial the discovered peer
    node.dial(peerId).catch((err) => {
      console.error(`Failed to dial ${peerId.toString()}:`, err);
    });
  });

  return node;
};

export { createNode };
