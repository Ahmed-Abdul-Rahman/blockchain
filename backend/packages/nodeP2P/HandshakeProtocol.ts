import { buildNodeURL, generateTimestamp, sha256 } from '@common/utils';
import { PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import * as lp from 'it-length-prefixed';
import { pipe } from 'it-pipe';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import { NetworkNodeConfig, Ping, StreamMessage } from './dataTypes';
import { ACTIVE, HSK_IN_PRGS, INFO_HASH_EXG, LOCKED, NTWK_DATA_EXG } from './messageTypes';
import { NetworkNode } from './NetworkNode';

export class HandshakeProtocol extends NetworkNode {
  protocol: string;

  constructor({ nodeConfig, protocol }: { nodeConfig: NetworkNodeConfig; protocol: string }) {
    super(nodeConfig);
    this.protocol = protocol;
  }

  async init(): Promise<void> {
    await super.init();
    await this.start();
  }

  getInfoHashMessage(): object {
    return {
      infoHash: this.infoHash,
      nodeEventId: this.nodeEventId,
      nodeId: this.nodeId,
      stage: INFO_HASH_EXG,
      timestamp: generateTimestamp(),
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

  getPingMesg(peerId: PeerId, status: string = LOCKED): Ping {
    return { targetNode: peerId.toString(), status, byPeer: this.nodeId, timestamp: generateTimestamp() };
  }

  async initiateHandshakeProtocol(peerId: PeerId, nodeAddress: string): Promise<void> {
    if (this.isPingRegistered) this.pingMessage(JSON.stringify(this.getPingMesg(peerId)));
    const stream = await this.dialNode(peerId, this.protocol);
    if (stream) {
      await this.writeToStream(stream, JSON.stringify(this.getInfoHashMessage()));
      this.nodeStore.updateNodeData(peerId.toString(), {
        nodePeerId: peerId,
        nodeAddress,
        timeline: [INFO_HASH_EXG],
        status: INFO_HASH_EXG,
        isHandler: null,
      });
    }
  }

  registerNodeDiscovery(): void {
    if (!this.node) return;
    this.node.addEventListener('peer:discovery', async (event) => {
      const peerId = event.detail.id;
      const { address } = event.detail.multiaddrs[1].nodeAddress();
      console.log(`Discovered Node: ${peerId.toString()} with address: ${address}`);
      if (!this.nodeStore.isNodeStatusLocked(peerId.toString())) await this.initiateHandshakeProtocol(peerId, address);
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
  }): Promise<void> {
    if (!this.node) return;
    const { infoHash, nodeEventId, nodeId } = infoMessageMessage;

    if (!infoHash || infoHash !== this.infoHash || !nodeEventId || !nodeId) {
      console.log('Ignoring node with invalid data');
      nodeId && this.nodeStore.deleteNode(nodeId);
      return;
    }
    this.nodeStore.updateNodeData(nodeId, { status: HSK_IN_PRGS });
    // commonSessionHash is the unqiue session identifier between these two peers
    if ((this.nodeEventId as string) >= (nodeEventId as string)) {
      // if the host node's eventId is greater then host will dial protocol to the peer node
      const commonSessionHash = sha256(`${this.nodeEventId}${nodeEventId}`);
      this.dialer(commonSessionHash, nodeId);
    } else {
      // Otherwise the host is the protocol handler and peer node is dialer
      const commonSessionHash = sha256(`${nodeEventId}${this.nodeEventId}`);
      this.handler(commonSessionHash);
    }
  }

  async dialer(sessionHash: string, nodeId: string): Promise<void> {
    if (!this.node) return;

    const peerIdToDial = peerIdFromString(nodeId);
    if (this.nodeStore.getNodeCurrentTimeline(nodeId) === INFO_HASH_EXG) {
      this.nodeStore.updateNodeData(nodeId, { isHandler: false });
      const stream = await this.dialNode(peerIdToDial, `${this.protocol}/${sessionHash}`);
      await this.writeToStream(stream, JSON.stringify(this.getNetworkExgMesg()));
      this.nodeStore.updateNodeCurrentTimeline(nodeId, NTWK_DATA_EXG);

      const [response] = await this.readFromStream(stream);
      console.log('Received message from handler: ', response);
      this.initiateNodeRegistration(response as StreamMessage, (x, y) => x >= y);
    } else
      console.log('Dialer Ignoring current message as peer node has not exchanged INFO yet or peer does not exist');
  }

  async handler(sessionHash: string): Promise<void> {
    if (!this.node) return;

    this.node.handle(`${this.protocol}/${sessionHash}`, async ({ stream }) => {
      const [response] = await this.readFromStream(stream);
      const { stage, nodeId } = response as StreamMessage;
      console.log('Received message from dialer: ', response);
      this.nodeStore.updateNodeData(nodeId, { isHandler: true, handlerProtocol: `${this.protocol}/${sessionHash}` });
      if (this.nodeStore.getNodeCurrentTimeline(nodeId) === INFO_HASH_EXG) {
        if (stage === NTWK_DATA_EXG) {
          this.writeToStream(stream, JSON.stringify(this.getNetworkExgMesg()));
          this.nodeStore.updateNodeCurrentTimeline(nodeId, NTWK_DATA_EXG);
        }
        this.initiateNodeRegistration(response as StreamMessage, (x, y) => x > y);
      } else console.log('Handler Ignoring current message as peer node has not exchanged INFO yet');
    });
  }

  initiateNodeRegistration(response: StreamMessage, evaluator: (x: number, y: number) => boolean): void {
    if (response === null) return;
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
      console.log('Node: ', this.nodeId, 'Should send API request ', registerNodeRequest);
    }
    if (this.nodeStore.getNodeDataProp(nodeId, 'isHandler'))
      this.unhandleProtocol(this.nodeStore.getNodeDataProp(nodeId, 'handlerProtocol') as string);
  }
}
