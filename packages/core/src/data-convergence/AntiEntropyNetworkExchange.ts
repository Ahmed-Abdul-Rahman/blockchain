import { logger } from '@dechat/common';
import { IncomingStreamData, Libp2p, PeerId, Startable } from '@libp2p/interface';
import { setupRPCStream } from '../shared/streamUtils';
import { DeChatComponents, DeChatFactory } from '../types';
import { PrefixTrie } from './PrefixTrie';
import { AntiEntropyMessage, SyncOutcome } from './types';

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
  public onMissingHashesDiscovered?: (hashes: readonly string[], peerId: PeerId) => void;

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
        const outcome = await this.executeSyncFlow(sendRequest);

        if (outcome.hashes.length > 0 && this.onMissingHashesDiscovered) {
          logger.debug(
            `[AntiEntropyNetworkExchange] Listener discovered ${outcome.hashes.length} missing hashes (status=${outcome.status}).`,
          );
          this.onMissingHashesDiscovered(outcome.hashes, connection.remotePeer);
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
   * @param peerId The target peer to sync with
   * @returns The {@link SyncOutcome} of the drill-down, or `null` if the stream
   *          could not be established at all (no diff information gained).
   */
  public async syncWithPeer(peerId: PeerId): Promise<SyncOutcome | null> {
    try {
      const stream = await this.node.dialProtocol(peerId, this.config.protocol);

      const { sendRequest } = setupRPCStream<AntiEntropyMessage>(stream, (message) =>
        this.handleIncomingMessage(message),
      );

      const outcome = await this.executeSyncFlow(sendRequest);
      if (outcome.hashes.length > 0) {
        logger.debug(
          `[AntiEntropyNetworkExchange] Dialer discovered ${outcome.hashes.length} missing hashes (status=${outcome.status}).`,
        );
      }
      return outcome;
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
   *
   * Returns a {@link SyncOutcome} so callers can tell an authoritative empty diff
   * (convergence) apart from a partial diff that was cut short by a timeout, an
   * unexpected response, or the drill-down depth cap. Any hashes collected before
   * the interruption are still returned so callers can fetch them opportunistically.
   */
  private async executeSyncFlow(
    sendRequest: (msg: AntiEntropyMessage) => Promise<AntiEntropyMessage>,
  ): Promise<SyncOutcome> {
    const missingHashes = new Set<string>();

    try {
      // Request the Top-N snapshot
      let response = await sendRequest({ type: 'REQUEST_TOP_N', levels: 2 });

      if (response.type !== 'RESPONSE_TOP_N') {
        return { status: 'partial', hashes: Array.from(missingHashes), reason: 'badResponse' };
      }

      let mismatches: string[] = this.trie.findMismatches(response.snapshot);

      // Iteratively drill down into mismatched branches (Max depth 64 for SHA256)
      let depthCounter = 0;

      while (mismatches.length > 0) {
        if (depthCounter >= 64) {
          // Branches still pending but we hit the SHA256 hex depth limit: incomplete.
          return { status: 'partial', hashes: Array.from(missingHashes), reason: 'depthCap' };
        }
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

        // If no more branches need drilling, every mismatch resolved to a leaf: done.
        if (prefixesToRequest.length === 0) break;

        // Request the next layer of branches
        response = await sendRequest({ type: 'REQUEST_BRANCHES', prefixes: prefixesToRequest });

        if (response.type !== 'RESPONSE_BRANCHES') {
          return { status: 'partial', hashes: Array.from(missingHashes), reason: 'badResponse' };
        }

        mismatches = []; // Reset for the next loop evaluation
        // Iterate over the prefixes we ASKED for, not just what came back. A dropped key
        // would otherwise silently end this branch's drill-down and lose missing hashes.
        for (const prefix of prefixesToRequest) {
          const branchSnapshot = response.branches[prefix];
          if (branchSnapshot === undefined) {
            return { status: 'partial', hashes: Array.from(missingHashes), reason: 'badResponse' };
          }
          mismatches.push(...this.trie.findMismatches(branchSnapshot));
        }
      }

      return { status: 'complete', hashes: Array.from(missingHashes) };
    } catch (error) {
      logger.error(`[AntiEntropyNetworkExchange] Sync flow timeout/failure: ${(error as Error).message}`);
      return { status: 'partial', hashes: Array.from(missingHashes), reason: 'timeout' };
    }
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
