import { buildNodeURL, generateTimestamp, sha256, wait } from '@common/utils';
import { PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import * as lp from 'it-length-prefixed';
import { pipe } from 'it-pipe';
import { debounce, DebouncedFunc, set } from 'lodash-es';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import {
  ACTIVE,
  HSK_IN_PRGS,
  INFO_HASH_EXG,
  INITIAL,
  NTWK_DATA_EXG,
  REJECT_REASON_TIMED_OUT,
  REQUEST,
  WAIT,
} from './messageTypes';
import { NetworkNode } from './NetworkNode';
import { isCustomRejectError, NetworkNodeConfig, Ping, StreamMessage } from './types';
import { readFromStream, writeToStream } from './utils';

export class HandshakeProtocol extends NetworkNode {
  protocol: string;
  coordinateNodeDiscoveryDe: DebouncedFunc<(peerId: PeerId, nodeAddress: string) => Promise<void>>;
  awaitingConnection: boolean;

  constructor({ nodeConfig, protocol }: { nodeConfig: NetworkNodeConfig; protocol: string }) {
    super(nodeConfig);
    this.protocol = protocol;
    this.coordinateNodeDiscoveryDe = debounce(this.coordinateNodeDiscovery.bind(this), 300, { trailing: true });
    this.awaitingConnection = false;
  }

  async init(): Promise<void> {
    await super.init();
    await this.start();
  }

  getWaitMessage(): object {
    return {
      stage: WAIT,
      timestamp: generateTimestamp(),
    };
  }

  getInfoHashMessage(): object {
    return {
      infoHash: this.infoHash,
      nodeEventId: this.nodeEventId,
      nodeId: this.nodeId,
      stage: INFO_HASH_EXG,
      timestamp: generateTimestamp(),
      nodeAddress: this.nodeAddress,
    };
  }

  getNetworkExgMesg(): object {
    return {
      connectedNodesCount: this.getNodesCount(),
      nodeAddress: this.nodeAddress,
      port: process.env.SERVER_PORT,
      nodeId: this.nodeId,
      stage: NTWK_DATA_EXG,
      timestamp: generateTimestamp(),
    };
  }

  generateRandomDelay(): number {
    let nodeHash = 0;
    for (let i = 0; i < this.nodeEventId.length; i++) {
      nodeHash = (nodeHash << 5) - nodeHash + this.nodeEventId.charCodeAt(i);
      nodeHash |= 0;
    }
    const nodeDelayOffset = Math.abs(nodeHash % 10000) % 50;
    const baseDelay = Math.random() * 20 + 1;
    return baseDelay + nodeDelayOffset;
  }

  triggerRandomPing(callback: Function): (...args) => Promise<unknown> {
    const finalDelay = this.generateRandomDelay();
    console.log('Final Delay ', finalDelay);
    return (...args) =>
      new Promise((resolve) => {
        setTimeout(() => {
          set(args[0], 'logicalTime', Date.now());
          const result = callback(...args);
          resolve(result);
        }, finalDelay);
      });
  }

  async coordinateNodeDiscovery(peerId: PeerId, nodeAddress: string): Promise<void> {
    if (!this.isPingRegistered) {
      this.initiateHandshakeProtocol(peerId, nodeAddress);
    } else {
      const triggerPingRandomly = this.triggerRandomPing(this.publishPingMsg.bind(this));
      const requestMessage = (await triggerPingRandomly(this.getPingMsg(peerId.toString(), REQUEST, 0))) as Ping;
      console.log(requestMessage);
      this.nodeStore.updateNodeData(peerId.toString(), {
        nodePeerId: peerId,
        nodeAddress,
        timeline: [INITIAL],
        status: INITIAL,
        pingDetails: {
          type: requestMessage.type,
          logicalTime: requestMessage.logicalTime,
          replyCounter: 0,
          deferCounter: 0,
          stopExec: false,
          waitingForAck: true,
        },
      });
      try {
        const isAllAcknowledged = await this.nodeStore.isEveryNodeAcknowledged(peerId.toString());
        console.log('AllAck Promise completed');
        if (isAllAcknowledged) this.initiateHandshakeProtocol(peerId, nodeAddress);
        else console.log(`Cannot dail new node: ${peerId.toString()}, Request was deferred by another node.`);
      } catch (error) {
        console.log('AllAck failed with: ', error);
        if (isCustomRejectError(error)) {
          if (error.reason === REJECT_REASON_TIMED_OUT) {
            const replyPercentage = error.isMajorityAcknowledged() || false;
            if (replyPercentage) {
              // this.initiateHandshakeProtocol(peerId, nodeAddress);
            }
          }
        }
      }
    }
  }

  /**
   * Critical Function Should be accessed by a new node or only one node in a network based on consensus
   */
  async initiateHandshakeProtocol(peerId: PeerId, nodeAddress: string): Promise<void> {
    const stream = await this.dialNode(peerId, this.protocol, 1);
    if (stream) {
      await writeToStream(stream, JSON.stringify(this.getInfoHashMessage()));
      this.nodeStore.updateNodeData(peerId.toString(), {
        nodePeerId: peerId,
        nodeAddress,
        timeline: [INFO_HASH_EXG],
        status: INFO_HASH_EXG,
        isDialer: null,
      });
    }
  }

  registerNodeDiscovery(): void {
    if (!this.node) return;
    this.node.addEventListener('peer:discovery', async (event) => {
      const peerId = event.detail.id;
      const { address } = event.detail.multiaddrs[1].nodeAddress();
      console.log(`Discovered Node: ${peerId.toString()} with address: ${address}`);
      this.coordinateNodeDiscoveryDe(peerId, address);
    });
  }

  receiveNodeMessages(): void {
    if (!this.node) return;
    this.node.handle(this.protocol, ({ stream }) => {
      pipe(
        stream,
        (source) => lp.decode(source),
        async (source) => {
          try {
            for await (const msg of source) {
              const message = uint8ArrayToString(msg.subarray());
              console.log('Received message: ', message);
              this.handleReceiveMessage(JSON.parse(message));
            }
          } catch (error) {
            console.log(`Expected a JSON parseable message`, error);
          }
        },
      );
    });
  }

  async handleReceiveMessage(infoMessageMessage: {
    infoHash: string;
    nodeEventId: string;
    nodeId: string;
    nodeAddress: string;
    stage: string;
  }): Promise<void> {
    if (!this.node) return;
    const { infoHash, nodeEventId, nodeId, nodeAddress, stage } = infoMessageMessage;
    if (stage === WAIT) {
      this.awaitingConnection = true;
      console.log('Waiting for connection from a network Node');
      return;
    }

    if (!infoHash || infoHash !== this.infoHash || !nodeEventId || !nodeId) {
      console.log('Ignoring node with invalid data');
      nodeId && this.nodeStore.deleteNode(nodeId);
      return;
    }

    if (this.nodeStore.hasNode(nodeId)) {
      if (this.nodeStore.getNodeDataProp(nodeId, 'pingDetails.waitingForAck')) {
        const peerId = this.nodeStore.getNodeDataProp(nodeId, 'nodePeerId') as PeerId;
        const stream = await this.dialNode(peerId, this.protocol, 3);
        if (stream) await writeToStream(stream, JSON.stringify(this.getWaitMessage()));
        console.log(`Sending await message till network nodes decide critical connection`);
        return;
      }
      if (this.nodeStore.getNodeDataProp(nodeId, 'pingDetails.stopExec')) {
        console.log(`0 Stopping execution of handshake with node: ${nodeId} as another has started it already.`);
        return;
      }
      this.nodeStore.updateNodeData(nodeId, { status: HSK_IN_PRGS });
    } else {
      // A new node will ignore the message from a network node in this case this node will not proceed and stay isolated
      if (!this.isPingRegistered && this.awaitingConnection) {
        this.awaitingConnection = false;
      }
      this.initiateHandshakeProtocol(peerIdFromString(nodeId), nodeAddress);
      // else {
      //   console.log(`Ignoring Node ${nodeId} as it is not present in the store`);
      //   return;
      // }
    }
    // commonSessionHash is the unqiue session identifier between these two peers
    if ((this.nodeEventId as string) >= (nodeEventId as string)) {
      // if the host node's eventId is greater then host will dial protocol to the peer node
      const commonSessionHash = sha256(`${this.nodeEventId}${nodeEventId}`);
      this.dialer(commonSessionHash, nodeId);
    } else {
      // Otherwise the host is the protocol handler and peer node is dialer
      const commonSessionHash = sha256(`${nodeEventId}${this.nodeEventId}`);
      this.handler(commonSessionHash, nodeId);
    }
  }

  async dialer(sessionHash: string, nodeId: string): Promise<void> {
    if (!this.node) return;
    if (this.nodeStore.hasNode(nodeId) && this.nodeStore.getNodeDataProp(nodeId, 'pingDetails.stopExec')) {
      console.log(`1 Stopping execution of handshake with node: ${nodeId} as another has started it already.`);
      return;
    }
    await wait(50); // give sometime for the handler to be registered as both dialer and handler are executed parallely on two different nodes
    const peerIdToDial = peerIdFromString(nodeId);
    if (this.nodeStore.getNodeCurrentTimeline(nodeId) === INFO_HASH_EXG) {
      this.nodeStore.updateNodeData(nodeId, { isDialer: false });
      const stream = await this.dialNode(peerIdToDial, `${this.protocol}/${sessionHash}`, 2);
      await writeToStream(stream, JSON.stringify(this.getNetworkExgMesg()));
      this.nodeStore.updateNodeCurrentTimeline(nodeId, NTWK_DATA_EXG);

      const [response] = await readFromStream(stream);
      console.log('Received message from handler: ', response);
      this.initiateNodeRegistration(response as StreamMessage, (x, y) => x >= y);
    } else
      console.log('Dialer Ignoring current message as peer node has not exchanged INFO yet or peer does not exist');
  }

  async handler(sessionHash: string, nodeId: string): Promise<void> {
    if (!this.node) return;

    if (this.nodeStore.hasNode(nodeId) && this.nodeStore.getNodeDataProp(nodeId, 'pingDetails.stopExec')) {
      console.log(`2 Stopping execution of handshake with node: ${nodeId} as another has started it already.`);
      return;
    }

    this.node.handle(`${this.protocol}/${sessionHash}`, async ({ stream }) => {
      const [response] = await readFromStream(stream);
      const { stage, nodeId } = response as StreamMessage;
      console.log('Received message from dialer: ', response);
      this.nodeStore.updateNodeData(nodeId, { isDialer: true, handlerProtocol: `${this.protocol}/${sessionHash}` });
      if (this.nodeStore.getNodeCurrentTimeline(nodeId) === INFO_HASH_EXG) {
        if (stage === NTWK_DATA_EXG) {
          writeToStream(stream, JSON.stringify(this.getNetworkExgMesg()));
          this.nodeStore.updateNodeCurrentTimeline(nodeId, NTWK_DATA_EXG);
        }
        this.initiateNodeRegistration(response as StreamMessage, (x, y) => x > y);
      } else console.log('Handler Ignoring current message as peer node has not exchanged INFO yet');
    });
  }

  initiateNodeRegistration(response: StreamMessage, evaluator: (x: number, y: number) => boolean): void {
    if (!response) return;
    const { connectedNodesCount, nodeAddress, port, nodeId } = response;
    if (connectedNodesCount == null || nodeId == null) return;

    // will need to move the below line somewhere else where you know you have successfully registered the node
    this.nodeStore.updateNodeData(nodeId, { status: ACTIVE, timeline: [] });
    this.handlePings();

    if (evaluator(this.getNodesCount(), connectedNodesCount) && nodeAddress != null && port != null) {
      const registerNodeRequest = {
        method: 'post',
        url: this.nodeStore.getNodeURL(nodeId, port) + '/register-and-broadcast-node',
        data: { newNodeUrl: buildNodeURL(this.nodeAddress, process.env.SERVER_PORT), nodeUUID: this.nodeId },
      };
      console.log('Node: ', this.nodeId?.toString(), 'Should send API request ', registerNodeRequest);
    }
    if (this.nodeStore.getNodeDataProp(nodeId, 'isDialer'))
      this.unhandleProtocol(this.nodeStore.getNodeDataProp(nodeId, 'handlerProtocol') as string);
  }
}
