import { GossipSub, gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { Message, PeerId, Stream } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { generateIdProtocolPrefix } from '@common/utils';

import { ACTIVE, ANNOUNCE_PRESENCE, ANNOUNCE_PRESENCE_RES, HEARTBEAT } from './messageTypes';
import { MessageUtility, setupMessageUtility } from './messageUtils';
import { NodeStore } from './NodeStore';
import { NetworkNodeConfig } from './types';

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
  isHeartbeatRegistered: boolean; // indicates if heartbeat protocol is handled and is this node ready send out heartbeat signals to other nodes
  pingProtocol: string;
  heartbeatProtocol: string;
  pubsub: GossipSub | null;
  utils: MessageUtility;

  constructor({ nodeEventId, networkId, infoHash, genesisTimestamp }: NetworkNodeConfig) {
    this.nodeEventId = nodeEventId;
    this.genesisTimestamp = genesisTimestamp;
    this.networkId = networkId;
    this.infoHash = infoHash;
    this.node = null;
    this.nodeId = null;
    this.nodeAddress = null;
    this.nodeStore = new NodeStore();
    this.pingProtocol = '/ping/1.0.0';
    this.isPingRegistered = false;
    this.heartbeatProtocol = '/heartbeat/node/1.0.0';
    this.isHeartbeatRegistered = false;
    this.pubsub = null;

    this.utils = setupMessageUtility(this);
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
        pubsub: gossipsub({ emitSelf: false, allowPublishToZeroTopicPeers: false }),
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

  publishMsg(protocol: string, message: string | object): boolean {
    try {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
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
      if (message.detail.topic === this.pingProtocol) this.handlePingMessages(message);
      if (message.detail.topic === this.heartbeatProtocol) this.handleHeartbeatMessages(message);
    });
    this.pubsub?.subscribe(this.pingProtocol);
    // this.pubsub?.subscribe(`${this.pingProtocol}/${this.nodeId?.toString()}`); not working !

    this.registerHeartbeat();
    this.isPingRegistered = true;
  }

  handlePingMessages(message: CustomEvent<Message>): void {
    const data = uint8ArrayToString(message.detail.data);
    try {
      const { type, fromNode, nodeData } = JSON.parse(data);
      console.log('Received ping from node: ', fromNode);
      if (type === ANNOUNCE_PRESENCE) {
        if (!this.nodeStore.hasNode(fromNode)) this.nodeStore.updateNodeData(fromNode, nodeData);
        setTimeout(() => this.publishMsg(this.pingProtocol, this.utils.getAnnounceMesgRes()), 10000); // Delay of 10sec so the network is not flooded with these messages all at once
      }
      if (type === ANNOUNCE_PRESENCE_RES) {
        if (!this.nodeStore.hasNode(fromNode)) this.nodeStore.updateNodeData(fromNode, nodeData);
      }
    } catch (error) {
      console.log(`Expected a JSON parseable message`, error);
    }
  }

  handleHeartbeatMessages(message: CustomEvent<Message>): void {
    const data = uint8ArrayToString(message.detail.data);
    try {
      const { type, fromNode, status } = JSON.parse(data);
      if (type === HEARTBEAT) {
        if (status === ACTIVE) this.nodeStore.updateNodeData(fromNode, status, 'status');
      }
    } catch (error) {
      console.log(`Expected a JSON parseable message`, error);
    }
  }

  announceNodePresence(): NodeJS.Timeout {
    const timeoutId = setTimeout(() => {
      this.publishMsg(this.pingProtocol, this.utils.getAnnounceMesg());
    }, 10000);
    return timeoutId;
  }

  registerHeartbeat(): NodeJS.Timeout {
    const intervalId = setInterval(() => {
      if (!this.isHeartbeatRegistered) {
        this.pubsub?.subscribe(this.heartbeatProtocol);
        this.isHeartbeatRegistered = true;
      } else
        this.publishMsg(this.heartbeatProtocol, {
          type: HEARTBEAT,
          fromNode: this.nodeId?.toString(),
          status: ACTIVE,
        });
    }, 60000);
    return intervalId;
  }
}
