import { logger } from '@dechat/common';
import { IncomingStreamData, Libp2p, PeerId, Startable } from '@libp2p/interface';
import { setupRPCStream } from '../shared/streamUtils';
import { DeChatComponents, DeChatFactory } from '../types';
import { PrefixTrie } from './PrefixTrie';
import { AntiEntropyMessage } from './types';

/**
 * Handles the Libp2p direct streams for state reconciliation.
 * Executes the Stateful Ping-Pong drill-down to find missing data.
 */
export class AntiEntropyNetworkExchange implements Startable {
  private readonly node: Libp2p;

  private readonly config: DeChatComponents['config']['strategies']['synchronizer'];

  private readonly trie: PrefixTrie;

  /**
   * Callback triggered when the handler side discovers missing hashes.
   * The AntiEntropyManager should attach a function to this to fetch the data.
   */
  public onMissingHashesDiscovered?: (hashes: string[], peerId: PeerId) => void;

  constructor(components: DeChatComponents) {
    if (!components.strategies?.prefixTrie) {
      throw new Error('AntiEntropyNetworkExchange requires a prefixTrie strategy.');
    }
    if (!components.config.strategies?.synchronizer?.protocol) {
      throw new Error('AntiEntropyNetworkExchange requires a protocol configuration.');
    }

    this.node = components.libp2p;
    this.config = components.config.strategies.synchronizer;
    this.trie = components.strategies.prefixTrie;
  }

  /**
   * Registers the protocol handler for incoming connections.
   * In a Bidirectional Sync, the Listener also acts as a requester
   */
  public start(): void {
    this.node.handle(this.config.protocol, async ({ stream, connection }: IncomingStreamData) => {
      logger.debug(`[AntiEntropyNetworkExchange] Incoming bidirectional sync from ${connection.remotePeer.toString()}`);
      try {
        const { sendRequest } = setupRPCStream<AntiEntropyMessage>(stream, (message) =>
          this.handleIncomingMessage(message),
        );
        const missingHashes = await this.executeSyncFlow(sendRequest);

        if (missingHashes.length > 0 && this.onMissingHashesDiscovered) {
          logger.debug(`[AntiEntropyNetworkExchange] Listener discovered ${missingHashes.length} missing hashes.`);
          this.onMissingHashesDiscovered(missingHashes, connection.remotePeer);
        }
      } catch (error) {
        logger.error(`[AntiEntropyNetworkExchange] Stream error: ${(error as Error)?.message}`);
      }
    });
  }

  public stop(): void {
    this.node.unhandle(this.config.protocol);
  }

  /**
   * The dialer actively dials a peer and triggers the bidirectional sync.
   * Returns a complete list of 64-char sha256 hashes that we need to fetch.
   * @param peerId The target peer to sync with
   * @returns An array of strictly missing full hashes
   */
  public async syncWithPeer(peerId: PeerId): Promise<string[] | null> {
    try {
      const stream = await this.node.dialProtocol(peerId, this.config.protocol);

      const { sendRequest } = setupRPCStream<AntiEntropyMessage>(stream, (message) =>
        this.handleIncomingMessage(message),
      );

      const missingHashes = await this.executeSyncFlow(sendRequest);
      if (missingHashes.length > 0) {
        logger.debug(`[AntiEntropyNetworkExchange] Dialer discovered ${missingHashes.length} missing hashes.`);
      }
      return missingHashes;
    } catch (error) {
      logger.error(
        `[AntiEntropyNetworkExchange] Failed to sync with peer ${peerId.toString()}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * The core drill-down loop used by BOTH the Dialer and the Listener.
   * Recursively asks for deeper branches until leaf hashes are identified.
   */
  private async executeSyncFlow(
    sendRequest: (msg: AntiEntropyMessage) => Promise<AntiEntropyMessage>,
  ): Promise<string[]> {
    const missingHashes = new Set<string>();

    try {
      // Request the Top-N snapshot
      let response = await sendRequest({ type: 'REQUEST_TOP_N', levels: 2 });
      let mismatches: string[] = [];

      if (response.type === 'RESPONSE_TOP_N') {
        mismatches = this.trie.findMismatches(response.snapshot);
      }

      // Iteratively drill down into mismatched branches (Max depth 64 for SHA256)
      let depthCounter = 0;

      while (mismatches.length > 0 && depthCounter < 64) {
        depthCounter++;
        const prefixesToRequest: string[] = [];

        // Segregate full hashes vs internal branches
        for (const mismatch of mismatches) {
          if (mismatch.length === 64) {
            missingHashes.add(mismatch);
          } else {
            prefixesToRequest.push(mismatch);
          }
        }

        // If no more branches need drilling, we are done
        if (prefixesToRequest.length === 0) break;

        // Request the next layer of branches
        response = await sendRequest({ type: 'REQUEST_BRANCHES', prefixes: prefixesToRequest });
        mismatches = []; // Reset for the next loop evaluation

        if (response.type === 'RESPONSE_BRANCHES') {
          for (const branchSnapshot of Object.values(response.branches)) {
            mismatches.push(...this.trie.findMismatches(branchSnapshot));
          }
        }
      }
    } catch (error) {
      logger.error(`[AntiEntropyNetworkExchange] Sync flow timeout/failure: ${(error as Error).message}`);
    }
    return Array.from(missingHashes);
  }

  /**
   * Pure function to handle incoming requests and return the required state.
   */
  private handleIncomingMessage(message: AntiEntropyMessage): AntiEntropyMessage | null {
    switch (message.type) {
      case 'REQUEST_TOP_N':
        return {
          type: 'RESPONSE_TOP_N',
          snapshot: this.trie.getTopN(message.levels),
        };
      case 'REQUEST_BRANCHES':
        return {
          type: 'RESPONSE_BRANCHES',
          branches: this.trie.getBranches(message.prefixes, 2),
        };
      default: {
        // Strict Type Guard to replace 'any'
        const typeStr =
          message && typeof message === 'object' && 'type' in message
            ? String((message as Record<string, unknown>).type)
            : 'UNKNOWN';
        logger.warn(`[AntiEntropyNetworkExchange] Unexpected message type: ${typeStr}`);
        return null;
      }
    }
  }
}

export const antiEntropyNetworkExchangeEngine = (): DeChatFactory<AntiEntropyNetworkExchange> => {
  return (components) => new AntiEntropyNetworkExchange(components);
};
