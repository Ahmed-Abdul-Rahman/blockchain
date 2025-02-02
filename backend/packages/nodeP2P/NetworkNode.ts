import { GossipSub, gossipsub } from '@chainsafe/libp2p-gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { PeerId, Stream } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import { DEFERRED, REPLY, REQUEST } from './messageTypes';
import { NodeStore } from './NodeStore';
import { NetworkNodeConfig, Ping, PingDetails, pingFunc } from './types';
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
        identify: identify(),
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

  async dialNode(nodeToDial: PeerId, protocol: string, instance: number): Promise<Stream | null> {
    if (!this.node) return null;
    try {
      console.log(`${instance} Dialing Protocol: ${protocol} to node: ${nodeToDial}`);
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

  isNewNode(): boolean {
    return !this.isPingRegistered && this.nodeStore.getSize() === 0;
  }

  publishPingMsg(message: string | object): object | string | null {
    if (!this.pubsub) return null;
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    this.pubsub?.publish(this.pingProtocol, uint8ArrayFromString(data));
    return message;
  }

  publishPingReply(protocol: string, message: string | object): boolean {
    if (!this.pubsub) return false;
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    if (this.isPingRegistered) this.pubsub.publish(protocol, uint8ArrayFromString(data));
    return this.isPingRegistered;
  }

  handlePings(): void {
    if (this.isPingRegistered || !this.pubsub || !this.nodeId) return;

    this.pubsub.addEventListener('message', (message) => {
      // console.log(`${message.detail.topic}:`, new TextDecoder().decode(message.detail.data));
      if (message.detail.topic === this.pingProtocol) {
        const data = uint8ArrayToString(message.detail.data);
        console.log('Received ping: ', data);
        const { type, logicalTime: reqLogicalTime, targetNode, byPeer, nodeEventId } = JSON.parse(data) as Ping;
        if (type === REQUEST) {
          const targetNodeData = this.nodeStore.getNodeDataProp(targetNode, 'pingDetails') as PingDetails;
          if (targetNodeData) {
            const { logicalTime } = targetNodeData;
            // if (!logicalClock) {
            //   console.log('Returning as logical clock is undefined for node: ', targetNode);
            //   return;
            // }
            // const currentTime = logicalClock.update(requestLogicalTime);
            // console.log(currentTime, requestLogicalTime, this.nodeEventId < nodeEventId);
            if (logicalTime < reqLogicalTime || (logicalTime === reqLogicalTime && this.nodeEventId < nodeEventId)) {
              console.log('Send Deferred the request');
              this.publishPingReply(byPeer, this.getPingMsg(targetNode, DEFERRED, 0));
            } else {
              // stop your execution of critical section
              this.publishPingReply(byPeer, this.getPingMsg(targetNode, REPLY, 0));
              this.nodeStore.updateNodeData(targetNode, { stopExec: true });
              console.log('I should stop executing critical section');
            }
          } else {
            this.publishPingReply(byPeer, this.getPingMsg(targetNode, REPLY, 0));
          }
        }
      } else if (message.detail.topic === this.nodeId?.toString()) {
        const data = uint8ArrayToString(message.detail.data);
        console.log('Received reply of ping: ', data);
        const { type, targetNode } = JSON.parse(data) as Ping;
        // We are maintaining the reply counter and deferred counter for the targetNode
        // if sum of both matches the number of nodes in nodeStore-1(-1 exclude the new node which is added before calling initiateHandshakeProtocol) t
        // is sum matches with nodeStore-1 that means all replies and defers were received.
        // if all are replies proceed to critical section
        // if any one of them if deferred then dont proceed to critical section
        if (type === REPLY) {
          const { replyCounter } = this.nodeStore.getNodeDataProp(targetNode, 'pingDetails') as PingDetails;
          this.nodeStore.updateNodeProp(targetNode, 'pingDetails.replyCounter', replyCounter + 1);
        } else if (type === DEFERRED) {
          const { deferCounter } = this.nodeStore.getNodeDataProp(targetNode, 'pingDetails') as PingDetails;
          this.nodeStore.updateNodeProp(targetNode, 'pingDetails.deferCounter', deferCounter + 1);
          // dont proceed to the critical section some other node has already taken access
        }
      }
    });
    this.pubsub.subscribe(this.pingProtocol);
    this.pubsub.subscribe(this.nodeId.toString());
    this.isPingRegistered = true;
  }
}
