import { buildNodeURL, pickRandom, sha256, wait } from '@common/utils';
import { Peer, PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { EventEmitter } from 'events';
import * as lp from 'it-length-prefixed';
import { pipe } from 'it-pipe';
import { debounce, DebouncedFunc } from 'lodash-es';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import { ACTIVE, HSK_IN_PRGS, INFO_HASH_EXG, NTWK_DATA_EXG, RETRY_EVENT } from './messageTypes';
import { NetworkNode } from './NetworkNode';
import { NetworkNodeConfig, StreamMessage } from './types';
import { getInfoHashMesg, getNetworkExgMesg, readFromStream, writeToStream } from './utils';

export class HandshakeProtocol extends NetworkNode {
  protocol: string;
  retryEvent: EventEmitter;
  coordinateNodeDiscoveryDe: DebouncedFunc<(peerId: PeerId, nodeAddress: string) => void>;
  getInfoHashMesg: Function;
  getNetworkExgMesg: Function;

  constructor({ nodeConfig, protocol }: { nodeConfig: NetworkNodeConfig; protocol: string }) {
    super(nodeConfig);
    this.protocol = protocol;
    this.retryEvent = new EventEmitter();
    this.coordinateNodeDiscoveryDe = debounce(this.coordinateNodeDiscovery.bind(this), 1000, { trailing: true });
    this.getInfoHashMesg = getInfoHashMesg.bind(this);
    this.getNetworkExgMesg = getNetworkExgMesg.bind(this);
    this.registerRetryHandshake();
  }

  async init(): Promise<void> {
    await super.init();
    await this.start();
  }

  coordinateNodeDiscovery(peerId: PeerId, nodeAddress: string): void {
    if (this.isNewNode()) {
      this.initiateHandshakeProtocol(peerId, nodeAddress);
    }
  }

  async initiateHandshakeProtocol(peerId: PeerId, nodeAddress: string): Promise<void> {
    const stream = await this.dialNode(peerId, this.protocol);
    if (stream) {
      await writeToStream(stream, JSON.stringify(this.getInfoHashMesg()));
      this.nodeStore.updateNodeData(peerId.toString(), {
        nodePeerId: peerId.toString(),
        nodeAddress,
        timeline: [INFO_HASH_EXG],
        status: INFO_HASH_EXG,
        isDialer: null,
      });
    }
  }
  retryHandshake(): void {
    this.retryEvent.emit(RETRY_EVENT);
    console.log('Retrying with a different peer node');
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

  registerRetryHandshake(): void {
    this.retryEvent.addListener(RETRY_EVENT, async () => {
      const peers = (await this.node?.peerStore.all()) as Peer[];
      if (this.isNewNode() && peers.length) {
        const randomPeer = pickRandom(peers) as Peer;
        const peerId = randomPeer.id;
        const nodeAddress = randomPeer.addresses[0].multiaddr.nodeAddress().address;
        this.initiateHandshakeProtocol(peerId, nodeAddress);
      }
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
            this.retryHandshake();
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
  }): Promise<void> {
    if (!this.node) return;
    const { infoHash, nodeEventId, nodeId, nodeAddress } = infoMessageMessage;

    if (!infoHash || infoHash !== this.infoHash || !nodeEventId || !nodeId) {
      console.log('Ignoring node with invalid data');
      nodeId && this.nodeStore.deleteNode(nodeId);
      this.retryHandshake();
      return;
    }
    if (this.nodeStore.hasNode(nodeId)) this.nodeStore.updateNodeData(nodeId, { status: HSK_IN_PRGS });
    else {
      this.initiateHandshakeProtocol(peerIdFromString(nodeId), nodeAddress);
    }
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
    await wait(50); // give sometime for the handler to be registered as both dialer and handler are executed parallely on two different nodes
    const peerIdToDial = peerIdFromString(nodeId);
    if (this.nodeStore.getNodeCurrentTimeline(nodeId) === INFO_HASH_EXG) {
      this.nodeStore.updateNodeData(nodeId, { isDialer: false });
      const stream = await this.dialNode(peerIdToDial, `${this.protocol}/${sessionHash}`);
      await writeToStream(stream, JSON.stringify(this.getNetworkExgMesg()));
      this.nodeStore.updateNodeCurrentTimeline(nodeId, NTWK_DATA_EXG);

      const [response] = await readFromStream(stream);
      console.log('Received message from handler: ', response);
      this.initiateNodeRegistration(response as StreamMessage, (x, y) => x >= y);
    } else
      console.log('Dialer Ignoring current message as peer node has not exchanged INFO yet or peer does not exist');
  }

  async handler(sessionHash: string): Promise<void> {
    if (!this.node) return;

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

  async initiateNodeRegistration(response: StreamMessage, evaluator: (x: number, y: number) => boolean): Promise<void> {
    if (!response) return;
    const { connectedNodesCount, nodeAddress, port, nodeId } = response;
    if (connectedNodesCount == null || nodeId == null) return;

    // will need to move the below line somewhere else where you know you have successfully registered the node
    this.nodeStore.updateNodeData(nodeId, { status: ACTIVE, timeline: [], nodeAddress, port });
    this.registerCommChannels();
    await wait(100);

    if (evaluator(this.nodeStore.getSize(), connectedNodesCount) && nodeAddress != null && port != null) {
      const registerNodeRequest = {
        method: 'post',
        url: this.nodeStore.getNodeURL(nodeId, port) + '/register-and-broadcast-node',
        data: {
          newNodeUrl: buildNodeURL(this.nodeAddress, process.env.SERVER_PORT),
          nodeUUID: this.nodeId?.toString(),
        },
      };
      console.log('Node: ', this.nodeId?.toString(), 'Should send API request ', registerNodeRequest);
    }
    if (this.nodeStore.getNodeDataProp(nodeId, 'isDialer')) {
      const handlerProtocol = this.nodeStore.getNodeDataProp(nodeId, 'handlerProtocol') as string;
      this.unhandleProtocol(handlerProtocol);
      this.nodeStore.updateNodeData(nodeId, { handlerProtocol: null });
    }
    this.registerNodeStoreUpdates();
  }
}
