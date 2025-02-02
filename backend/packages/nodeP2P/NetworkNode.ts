import { GossipSub, gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { generateIdProtocolPrefix } from '@common/utils';
import { identify } from '@libp2p/identify';
import { Message, PeerId, Stream } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import { REQ_NODE_DATA, REQ_NODE_META_DATA, RES_NODE_DATA, RES_NODE_META_DATA } from './messageTypes';
import { NodeStore } from './NodeStore';
import { NetworkNodeConfig, Ping } from './types';

export class NetworkNode {
  nodeEventId: string; // unique monotonically incresing unique id to compare with peers to establish handshake
  genesisTimestamp: number; // timestamp of when this node was initialized
  networkId: string; // unique network id of this p2p network
  infoHash: string; // unique identifier for peer discovery of similar nodes
  node: Libp2p | null;
  nodeId: PeerId | null; // peerId of this node
  nodeAddress: string | null; // address of the this node
  nodeStore: NodeStore; // store all the connected nodes
  isPingRegistered: boolean; // indicates if ping protocol is handled and is this node part of the network
  pingProtocol: string;
  pubsub: GossipSub | null;

  constructor({ nodeEventId, networkId, infoHash, genesisTimestamp }: NetworkNodeConfig) {
    this.nodeEventId = nodeEventId;
    this.genesisTimestamp = genesisTimestamp;
    this.networkId = networkId;
    this.infoHash = infoHash;
    this.node = null;
    this.nodeId = null;
    this.nodeAddress = null;
    this.nodeStore = new NodeStore();
    this.isPingRegistered = false;
    this.pingProtocol = '/ping/1.0.0';
    this.pubsub = null;
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
      services: {
        identify: identify({
          protocolPrefix: generateIdProtocolPrefix(this.infoHash),
          agentVersion: 'NodeAgent-1.0.0',
        }),
        pubsub: gossipsub({ emitSelf: false, allowPublishToZeroTopicPeers: true }),
      },
    });
    this.pubsub = this.node.services.pubsub as GossipSub;
  }

  async start(): Promise<void> {
    if (!this.node) return;
    await this.node.start();
    this.nodeId = this.node.peerId || null;
    this.nodeAddress = this.node.getMultiaddrs()[1].nodeAddress().address;
    process.env.NODE_ADDRESS = this.node.getMultiaddrs()[1].nodeAddress().address;
  }

  isNewNode(): boolean {
    return !this.isPingRegistered || this.nodeStore.getSize() === 0;
  }

  async dialNode(nodeToDial: PeerId, protocol: string): Promise<Stream | null> {
    if (!this.node) return null;
    try {
      console.log(`Dialing Protocol: ${protocol} to node: ${nodeToDial}`);
      const stream = (await this.node.dialProtocol(nodeToDial, protocol)) || null;
      return stream;
    } catch (err) {
      console.error(`Failed to dial ${nodeToDial.toString()}: with protocol: ${protocol}`, err);
      return null;
    }
  }

  async unhandleProtocol(protocol: string): Promise<void> {
    await this.node?.unhandle(protocol);
  }

  publishPingMsg(protocol: string, message: string | object): boolean {
    try {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      console.log('Pinging protocol ', protocol);
      if (this.isPingRegistered) this.pubsub?.publish(protocol, uint8ArrayFromString(data));
      return this.isPingRegistered;
    } catch (error) {
      console.log('Failed to publish message: ', error);
      return false;
    }
  }

  registerCommChannels(): void {
    if (this.isPingRegistered) return;
    this.pubsub?.addEventListener('message', (message) => {
      switch (message.detail.topic) {
        case this.pingProtocol:
          this.handlePingMessages(message);
          break;
        case `${this.pingProtocol}/${this.nodeId?.toString()}`:
          this.handleSelfNodePings(message);
          break;
        default:
          break;
      }
    });
    this.pubsub?.subscribe(this.pingProtocol);
    this.pubsub?.subscribe(`${this.pingProtocol}/${this.nodeId?.toString()}`);
    this.isPingRegistered = true;
  }

  // We need to handle the nodes store synchrnoization problem - at present nodes have different copies of nodes
  registerNodeStoreUpdates(): NodeJS.Timeout {
    const intervalId = setInterval(() => {
      this.publishPingMsg(this.pingProtocol, { type: REQ_NODE_META_DATA, fromNode: this.nodeId?.toString() });
    }, 30000);
    return intervalId;
  }

  handlePingMessages(message: CustomEvent<Message>): void {
    const data = uint8ArrayToString(message.detail.data);
    console.log('Received ping: ', data);
    const { type, fromNode } = JSON.parse(data) as Ping;
    if (type === REQ_NODE_META_DATA) {
      this.publishPingMsg(`${this.pingProtocol}/${fromNode}`, {
        type: RES_NODE_META_DATA,
        fromNode: this.nodeId?.toString(),
        nodeCount: this.nodeStore.getSize(),
      });
    } else if (type === REQ_NODE_DATA) {
      this.publishPingMsg(`${this.pingProtocol}/${fromNode}`, {
        type: RES_NODE_DATA,
        fromNode: this.nodeId?.toString(),
        nodeEntries: this.nodeStore.getNodeEntries(),
      });
    }
  }

  handleSelfNodePings(message: CustomEvent<Message>): void {
    const data = uint8ArrayToString(message.detail.data);
    const { type, nodeEntries, nodeCount, fromNode } = JSON.parse(data);
    console.log('Received node info');
    if (type === RES_NODE_META_DATA) {
      if (nodeCount !== 0 && this.nodeStore.getSize() != nodeCount) {
        this.publishPingMsg(`${this.pingProtocol}/${fromNode}`, {
          type: REQ_NODE_DATA,
          fromNode: this.nodeId?.toString(),
        });
      } else console.log('Nodes already upto date.');
    } else if (type === RES_NODE_DATA) {
      if (nodeEntries && nodeEntries.length != 0 && nodeEntries.length != this.nodeStore.getSize()) {
        this.nodeStore.updateNodeStore(nodeEntries);
        this.nodeStore.deleteNode(this.nodeId?.toString() as string);
      }
    }
  }
}
