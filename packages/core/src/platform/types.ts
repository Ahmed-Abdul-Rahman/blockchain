import type { Libp2pOptions } from 'libp2p';

/**
 * Everything `createNode` needs that varies by runtime (Node vs browser).
 * Protocol modules must never import TCP/mDNS/WebSocket packages directly — only this seam.
 */
export interface Libp2pPlatformStack {
  /** libp2p transport modules (e.g. `tcp()`, `webSockets()`). */
  readonly transports: NonNullable<Libp2pOptions['transports']>;

  /** Stream multiplexers (typically yamux). */
  readonly streamMuxers: NonNullable<Libp2pOptions['streamMuxers']>;

  /** Connection encryption (typically Noise). */
  readonly connectionEncrypters: NonNullable<Libp2pOptions['connectionEncrypters']>;

  /** Peer discovery plugins (mDNS, bootstrap, …). */
  readonly peerDiscovery: NonNullable<Libp2pOptions['peerDiscovery']>;

  /**
   * Multiaddrs passed to `createLibp2p({ addresses: { listen } })`.
   * Browser stacks are usually dial-only and may return an empty list.
   */
  readonly listenAddrs: readonly string[];

  /**
   * Extra libp2p services merged into the node (e.g. relay client).
   * Identify + GossipSub remain owned by the composition root.
   */
  readonly services?: Record<string, unknown>;
}

/** Discriminated platform profile used for defaults and validation. */
export type PlatformProfile =
  | {
      readonly kind: 'node';
      readonly listenAddrs?: readonly string[];
      readonly enableMdns?: boolean;
      readonly bootstrapPeers?: readonly string[];
    }
  | {
      readonly kind: 'browser';
      readonly bootstrapPeers: readonly string[];
      /** mDNS is Node LAN only — browser profile forbids enabling it. */
      readonly enableMdns?: false;
      readonly listenAddrs?: readonly string[];
    };
