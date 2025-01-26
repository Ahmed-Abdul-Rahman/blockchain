import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { PeerId } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { pipe } from 'it-pipe';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

export interface NetworkNodeConfig {
  genesisTimestamp: number;
  protocol: string;
  networkId: string;
}

export class NetworkNode {
  genesisTimestamp: number;
  protocol: string;
  networkId: string;
  node: Libp2p | null;
  nodeId: string | null;

  constructor({ genesisTimestamp, protocol, networkId }: NetworkNodeConfig) {
    this.genesisTimestamp = genesisTimestamp;
    this.protocol = protocol;
    this.networkId = networkId;
    this.node = null;
    this.nodeId = null;
  }

  async init(): Promise<void> {
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

  async start(): Promise<void> {
    await this.node?.start();
    this.nodeId = this.node?.peerId.toString() || null;
  }

  async dialNode(nodeToDial: PeerId, message: string): Promise<void> {
    try {
      const stream = await this.node?.dialProtocol(nodeToDial, this.protocol);
      if (stream) await pipe([uint8ArrayFromString(message)], stream);
      else console.error(`Failed to dial ${nodeToDial.toString()}: stream is undefined`);
    } catch (err) {
      console.error(`Failed to dial ${nodeToDial.toString()}:`, err);
    }
  }

  registerNodeDiscovery(messageToDial: object, onNodeDiscovery: Function | null): void {
    this.node?.addEventListener('peer:discovery', (event) => {
      const peerId = event.detail.id;
      const { address } = event.detail.multiaddrs[1].nodeAddress();
      console.log(`Discovered Node: ${peerId.toString()} with address: ${address}`);
      const serializedMessage = JSON.stringify({
        ...messageToDial,
        nodeId: this.nodeId,
      });
      if (onNodeDiscovery && typeof onNodeDiscovery === 'function')
        onNodeDiscovery(this.node, peerId, this.protocol, serializedMessage);
      else this.dialNode(peerId, serializedMessage);
    });
  }

  receiveNodeMessages(onReceiveMessage: Function): void {
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
