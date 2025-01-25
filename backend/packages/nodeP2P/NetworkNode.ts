import { createLibp2p, Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mdns } from '@libp2p/mdns';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { pipe } from 'it-pipe';

export class NetworkNode {
  genesisTimestamp: number;
  protocol: string;
  networkId: string;
  node: Libp2p | null;
  nodeId: string | null;

  constructor({ genesisTimestamp, protocol, networkId }) {
    this.genesisTimestamp = genesisTimestamp;
    this.protocol = protocol;
    this.networkId = networkId;
    this.node = null;
    this.nodeId = null;
  }

  async init() {
    this.node = await createLibp2p({
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
  }

  async start() {
    await this.node?.start();
    this.nodeId = this.node?.peerId.toString() || null;
  }

  defaultSink(source) {
    return source;
  }

  async dialNode(nodeToDial, message) {
    try {
      const stream = (await this.node?.dialProtocol(nodeToDial, this.protocol)) || this.defaultSink;
      await pipe([uint8ArrayFromString(message)], stream);
    } catch (err) {
      console.error(`Failed to dial ${nodeToDial.toString()}:`, err);
    }
  }

  registerNodeDiscovery(messageToDial, onNodeDiscovery) {
    this.node?.addEventListener('peer:discovery', (event) => {
      const peerId = event.detail.id;
      const { address } = event.detail.multiaddrs[1].nodeAddress();
      console.log(`Discovered Node: ${peerId.toString()} with address: ${address}`);
      const serializedMessage = JSON.stringify({ ...messageToDial, nodeId: this.nodeId });
      if (onNodeDiscovery && typeof onNodeDiscovery === 'function')
        onNodeDiscovery(this.node, peerId, this.protocol, serializedMessage);
      else this.dialNode(peerId, serializedMessage);
    });
  }

  receiveNodeMessages(onReceiveMessage) {
    this.node?.handle(this.protocol, ({ stream }) => {
      pipe(stream, async (source) => {
        for await (const msg of source) {
          const message = uint8ArrayToString(msg.subarray());
          console.log('Received message: ', message);
          onReceiveMessage(JSON.parse(message));
        }
      });
    });
  }
}
