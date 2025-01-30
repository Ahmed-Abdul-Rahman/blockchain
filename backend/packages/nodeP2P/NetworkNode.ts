import { GossipSub, gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { PeerId, Stream } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import { NetworkNodeConfig, Ping, pingFunc } from './dataTypes';
import { REPLY, REQUEST } from './messageTypes';
import { NodeStore } from './NodeStore';
import { getPingMesg } from './utils';

export class NetworkNode {
  nodeEventId: string; // unique monotonically incresing unique id to compare with peers to establish handshake
  networkId: string; // unique network id of this p2p network
  infoHash: string; // unique identifier for peer discovery of similar nodes
  node: Libp2p | null;
  nodeId: PeerId | null; // peerId of this node
  nodeAddress: string | null; // address of the this node
  getNodesCount: Function;
  nodeStore: NodeStore; // store all the connected nodes
  isPingRegistered: boolean; // indicates if ping protocol is handled and is this node part of the network
  pingProtocol: string;
  pubsub: GossipSub | null;
  getPingMsg: pingFunc;

  constructor({ nodeEventId, networkId, infoHash, getNodesCount }: NetworkNodeConfig) {
    this.nodeEventId = nodeEventId;
    this.networkId = networkId;
    this.infoHash = infoHash;
    this.node = null;
    this.nodeId = null;
    this.nodeAddress = null;
    this.getNodesCount = getNodesCount;
    this.nodeStore = new NodeStore();
    this.isPingRegistered = false;
    this.pingProtocol = '/ping/1.0.0';
    this.pubsub = null;
    this.getPingMsg = getPingMesg.bind(this);
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
        pubsub: gossipsub({ emitSelf: false }),
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

  async writeToStream(stream: Stream | null, message: string): Promise<void> {
    if (!stream) {
      console.log('Cannot write to stream as it is null');
      return;
    }
    await pipe(
      [message],
      (source) => map(source, (string) => uint8ArrayFromString(string)),
      (source) => lp.encode(source), // Encode with length prefix (so receiving side knows how much data is coming)
      stream,
    );
  }

  async readFromStream(stream: Stream | null): Promise<Partial<object>[]> {
    if (!stream) {
      console.log('Cannot read from stream as it is null');
      return [];
    }
    return await pipe(
      stream,
      (source) => lp.decode(source),
      (source) => map(source, (buffer) => uint8ArrayToString(buffer.subarray())),
      async (source) => {
        const messages: Array<Partial<object>> = [];
        for await (const message of source) messages.push(JSON.parse(message));
        return messages;
      },
    );
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

  publishPingMsg(message: string | object): boolean {
    // this.nodeStore.getNodeEntries().forEach(async ({ nodePeerId }) => {
    //   const stream = await this.dialNode(nodePeerId, this.pingProtocol);
    //   if (stream) this.writeToStream(stream, message);
    // });
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    if (this.isPingRegistered) this.pubsub?.publish(this.pingProtocol, uint8ArrayFromString(data));
    return this.isPingRegistered;
  }

  handlePings(): void {
    if (this.isPingRegistered) return;
    this.pubsub?.addEventListener('message', (message) => {
      // console.log(`${message.detail.topic}:`, new TextDecoder().decode(message.detail.data));
      if (message.detail.topic === this.pingProtocol) {
        const data = uint8ArrayToString(message.detail.data);
        console.log('Received ping: ', data);
        const { type, timestamp, targetNode, byPeer } = JSON.parse(data) as Ping;
        if (type === REQUEST) {
          const targetNodeData = this.nodeStore.getNodeData(targetNode);
          if (targetNodeData) {
            const { requestTimestamp } = targetNodeData; // TODO compare this requestTimestamp with timestamp whichever is less will be given access to critical function
          } else {
            this.publishPingMsg(this.getPingMsg(REPLY, targetNode));
          }
        } else if (type === REPLY) {
          // this might be a wrong place to update
          // We need to maintain a list of all the replies for a given targetNode
          // not directly update a peer who sent this reply
          // Think about this more!
          this.nodeStore.updateNodeData(byPeer, { requestStatus: REPLY });
        }
        // what if some node does not have this tragetNode present yet
        // if (status === LOCKED) this.nodeStore.updateNodeData(targetNode, { status: LOCKED });
      }
    });
    this.pubsub?.subscribe(this.pingProtocol);
    this.isPingRegistered = true;
    // this.node?.handle(this.pingProtocol, async ({ stream }) => {
    //   pipe(
    //     stream,
    //     (source) => lp.decode(source),
    //     async (source) => {
    //       try {
    //         for await (const msg of source) {
    //           const message = uint8ArrayToString(msg.subarray());
    //           console.log('Received ping: ', message);
    //           const { status, targetNode } = JSON.parse(message) as Ping;
    //           // what if some node does not have this tragetNode present yet
    //           if (status === LOCKED) this.nodeStore.updateNodeData(targetNode, { status: LOCKED });
    //         }
    //       } catch (error) {
    //         console.log(`Expected a JSON parseable ping message`, error);
    //       }
    //     },
    //   );
    // });
  }
}
