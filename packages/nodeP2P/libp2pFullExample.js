import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { pipe } from 'it-pipe';
import { createLibp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

const createNode = async () => {
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0'],
    },
    transports: [tcp()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
  });

  node.handle('/a-protocol', ({ stream }) => {
    pipe(stream, async function (source) {
      for await (const msg of source) {
        console.log(uint8ArrayToString(msg.subarray()));
      }
    });
  });

  node.addEventListener('peer:discovery', async (event) => {
    const peerId = event.detail.id;
    console.log(`Discovered peer: ${peerId.toString()}`);
    console.log(`MultiAddrs: `, event.detail.multiaddrs[1].nodeAddress());
    const stream = await node.dialProtocol(peerId, '/a-protocol');
    await pipe([uint8ArrayFromString('This information is sent out encrypted to the other peer')], stream);
  });
  return node;
};

const start = async () => {
  const node = await createNode();
  await node.start();
  console.log('Node started ', node.peerId.toString());
};

start();
