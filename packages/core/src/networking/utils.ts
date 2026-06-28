import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { logger } from '@dechat/common';
import { cloneDeep } from 'es-toolkit';

export const trivialSampling = <T>(array: T[], limit: number): number[] => {
  const chosenIndices: number[] = [];
  const seenItems = new Set<number>();
  while (chosenIndices.length < limit) {
    const randIndex = (Math.random() * array.length) | 0;
    if (!seenItems.has(randIndex)) {
      seenItems.add(randIndex);
      chosenIndices.push(randIndex);
    }
  }
  return chosenIndices;
};

export const floydSampling = <T>(array: T[], limit: number): number[] => {
  const chosenIndices: number[] = [];
  const seenItems = new Set<number>();
  const n = array.length;
  for (let j = n - limit; j < n; j++) {
    const randIndex = Math.floor(Math.random() * (j + 1));
    if (!seenItems.has(randIndex)) {
      seenItems.add(randIndex);
      chosenIndices.push(randIndex);
    } else {
      seenItems.add(j);
      chosenIndices.push(j);
    }
  }
  return chosenIndices;
};

export const sampleList = <T>(array: T[], limit: number): T[] => {
  if (array.length <= limit) return [...array];
  const chosenIndices = floydSampling(array, limit);
  return chosenIndices.map((index) => cloneDeep(array[index]));
};

export const sleep = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

export const filterAddrs = (addrs: string[]): string[] => (addrs || []).slice(0, 4);

/**
 * Normalizes a multiaddr for outbound dialing on the same host (e.g. interop workers).
 * Rewrites wildcard listen IPs and ensures a /p2p/ component is present.
 */
export const normalizeDialAddr = (addr: string, peerId: string): string | null => {
  if (!addr.includes('/ip4/') && !addr.includes('/ip6/')) return null;

  let normalized = addr.replace('/ip4/0.0.0.0/', '/ip4/127.0.0.1/');
  if (!normalized.includes('/p2p/')) {
    normalized = `${normalized}/p2p/${peerId}`;
  }
  return normalized;
};

/** Returns unique, dial-ready multiaddrs for a peer. */
export const normalizeDialAddrs = (addrs: readonly string[], peerId: string): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const addr of addrs) {
    const normalized = normalizeDialAddr(addr, peerId);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
};

export const publishWithRetry = async (
  pubsub: GossipSub,
  topic: string,
  data: Uint8Array,
  opts: { retries: number; baseDelay: number },
): Promise<void> => {
  const retries = opts.retries;
  const baseDelay = opts.baseDelay;
  for (let i = 0; i < retries; i++) {
    try {
      await pubsub.publish(topic, data);
      return;
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes('PublishError.NoPeersSubscribedToTopic') || msg.includes('NoPeersSubscribedToTopic')) {
        const backoff = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 200);
        logger.info('NoPeersSubscribedToTopic error retrying again in: ', backoff, 'ms');
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error('publishWithRetry: exhausted retries');
};
