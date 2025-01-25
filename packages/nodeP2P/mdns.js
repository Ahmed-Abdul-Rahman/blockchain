import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mdns } from '@libp2p/mdns';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { pipe } from 'it-pipe';

const PROTOCOL = '/hanshake/1.0.0';

export const createNode = async () => {
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0'],
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      mdns({
        interval: 10e3,
      }),
    ],
  });
  return node;
};

export const dialNode = async (node, nodeToDial, protocol, message) => {
  try {
    const stream = await node.dialProtocol(nodeToDial, protocol);
    await pipe([uint8ArrayFromString(message)], stream);
  } catch (err) {
    console.error(`Failed to dial ${nodeToDial.toString()}:`, err);
  }
};

export const registerNodeDiscovery = (node, onNodeDiscovery, messageToDial) => {
  node.addEventListener('peer:discovery', (event) => {
    const peerId = event.detail.id;
    const { address } = event.detail.multiaddrs[1].nodeAddress();
    console.log(`Discovered Node: ${peerId.toString()}`);
    console.log(`Node address: `, address);
    onNodeDiscovery(node, peerId, PROTOCOL, messageToDial);
  });
};

export const recieveNodeMessages = (node, onReceiveMessage) => {
  node.handle(PROTOCOL, ({ stream }) => {
    pipe(stream, async (source) => {
      for await (const msg of source) {
        const message = uint8ArrayToString(msg.subarray());
        console.log('Received message: ', message);
        onReceiveMessage(JSON.parse(message));
      }
    });
  });
};
