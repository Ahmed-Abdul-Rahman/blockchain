import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { sha256 } from '@common/utils';
import { PeerId, Stream } from '@libp2p/interface';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { pipe } from 'it-pipe';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

import { INFO_HASH_EXG, NETWORK_DATA_EXG } from './messageTypes';

interface StreamMessage {
  nodeAddress: string;
  infoHash: string;
  nodeEventId: string;
  nodeId: string;
  connectedNodesCount: number;
  stage: string;
}

export interface NetworkNodeConfig {
  nodeEventId: string;
  protocol: string;
  networkId: string;
  infoHash: string;
  getConnectNodeCount: Function;
}

interface NodeTimelines {
  [nodeId: string]: string[];
}

export class NetworkNode {
  nodeEventId: string;
  protocol: string;
  networkId: string;
  infoHash: string;
  node: Libp2p | null;
  nodeId: string | null;
  nodeAddress: string | null;
  getConnectNodeCount: Function;
  timeline: NodeTimelines;

  constructor({ nodeEventId, protocol, networkId, infoHash, getConnectNodeCount }: NetworkNodeConfig) {
    this.nodeEventId = nodeEventId;
    this.protocol = protocol;
    this.networkId = networkId;
    this.infoHash = infoHash;
    this.node = null;
    this.nodeId = null;
    this.nodeAddress = null;
    this.getConnectNodeCount = getConnectNodeCount;
    this.timeline = {} as NodeTimelines;
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
    if (!this.node) return;
    await this.node.start();
    this.nodeId = this.node.peerId.toString() || null;
    this.nodeAddress = this.node.getMultiaddrs()[1].nodeAddress().address;
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

  getInfoHashMessage(): object {
    return {
      infoHash: this.infoHash,
      nodeEventId: this.nodeEventId,
      nodeId: this.nodeId,
      stage: INFO_HASH_EXG,
    };
  }

  registerNodeDiscovery(): void {
    if (!this.node) return;
    this.node.addEventListener('peer:discovery', async (event) => {
      const peerId = event.detail.id;
      const { address } = event.detail.multiaddrs[1].nodeAddress();
      console.log(`Discovered Node: ${peerId.toString()} with address: ${address}`);
      const stream = await this.dialNode(peerId, this.protocol);
      if (stream) {
        await this.writeToStream(stream, JSON.stringify(this.getInfoHashMessage()));
        this.updateCurrentNodeTimeline(peerId.toString(), INFO_HASH_EXG);
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
          }
        },
      );
    });
  }

  getCurrentNodeTimeline(nodeId: string | undefined): string | null {
    if (!nodeId) return null;
    return this.timeline[nodeId][this.timeline[nodeId].length - 1];
  }

  updateCurrentNodeTimeline(nodeId: string | undefined | null, currentStage: string): void {
    if (!nodeId) return;
    if (this.timeline.hasOwnProperty(nodeId)) this.timeline[nodeId].push(currentStage);
    else this.timeline[nodeId] = [currentStage];
  }

  clearNodeTimeline(nodeId: string): void {
    delete this.timeline[nodeId];
  }

  getNodeURL(address: string | null, port: string | null = '8080'): string {
    return `http://${address}:${port}`;
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
      return;
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

  async readFromStream(stream: Stream | null): Promise<Partial<StreamMessage>[]> {
    if (!stream) {
      console.log('Cannot read from stream as it is null');
      return [];
    }
    return await pipe(
      stream,
      (source) => lp.decode(source),
      (source) => map(source, (buffer) => uint8ArrayToString(buffer.subarray())),
      async (source) => {
        const messages: Array<Partial<StreamMessage>> = [];
        for await (const message of source) messages.push(JSON.parse(message));
        return messages;
      },
    );
  }

  initiateNodeRegistration(response: Partial<StreamMessage>, evaluator: (x: number, y: number) => boolean): void {
    const { connectedNodesCount, nodeAddress } = response;
    if (
      connectedNodesCount != null &&
      evaluator(this.getConnectNodeCount(), connectedNodesCount) &&
      nodeAddress != null
    ) {
      const registerNodeRequest = {
        method: 'post',
        url: this.getNodeURL(nodeAddress) + '/register-and-broadcast-node',
        data: { newNodeUrl: this.getNodeURL(this.nodeAddress), nodeUUID: this.nodeId },
      };
      console.log('Node: ', this.nodeId, 'Should send API request ', registerNodeRequest);
    }
  }

  getNetworkExgMesg(): object {
    return {
      connectedNodesCount: this.getConnectNodeCount(),
      nodeAddress: this.nodeAddress,
      nodeId: this.nodeId,
      stage: NETWORK_DATA_EXG,
    };
  }

  async dialer(sessionHash: string, nodeId: string): Promise<void> {
    if (!this.node) return;

    const peerIdToDial = this.node.getPeers().find((peerId) => peerId.toString() === nodeId);
    if (peerIdToDial) {
      if (this.getCurrentNodeTimeline(nodeId) === INFO_HASH_EXG) {
        const stream = await this.dialNode(peerIdToDial, `${this.protocol}/${sessionHash}`);
        await this.writeToStream(stream, JSON.stringify(this.getNetworkExgMesg()));
        this.updateCurrentNodeTimeline(nodeId, NETWORK_DATA_EXG);

        const [response] = await this.readFromStream(stream);
        console.log('Received message from handler: ', response);
        this.initiateNodeRegistration(response, (x, y) => x >= y);
      } else console.log('Ignoring current message as peer node has not exchanged INFO yet');
    }
  }

  async handler(sessionHash: string): Promise<void> {
    if (!this.node) return;

    this.node.handle(`${this.protocol}/${sessionHash}`, async ({ stream }) => {
      const [response] = await this.readFromStream(stream);
      const { stage, nodeId } = response;
      console.log('Received message from dialer: ', response);

      if (this.getCurrentNodeTimeline(nodeId) === INFO_HASH_EXG) {
        if (stage === NETWORK_DATA_EXG) {
          this.writeToStream(stream, JSON.stringify(this.getNetworkExgMesg()));
          this.updateCurrentNodeTimeline(nodeId, NETWORK_DATA_EXG);
        }
        this.initiateNodeRegistration(response, (x, y) => x > y);
      } else console.log('Ignoring current message as peer node has not exchanged INFO yet');
    });
  }
}
