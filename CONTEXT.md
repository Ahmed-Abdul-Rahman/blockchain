# DeChat Domain Glossary

Ubiquitous language for DeChat — a decentralized P2P networking platform (libp2p + TypeScript). Glossary only; no implementation details.

## Network & Identity

| Term | Definition |
|------|------------|
| **Node** | A running DeChat P2P participant — one libp2p instance with a persistent Ed25519 identity. |
| **Peer** | Any remote libp2p participant the node can discover or connect to. |
| **Verified peer** | A peer that completed the Ed25519 authentication handshake; eligible for `PeerRegistry` and dialing. |
| **Network ID** (`infoHash`) | Identifier that partitions this DeChat mesh from other libp2p or DeChat deployments. Not a room membership credential. Peers on different network IDs do not interoperate. |
| **Node seed** | Deterministic input used to derive the node's Ed25519 keypair so the same identity can be restored after restart. |
| **Identity seed** | Chat-facing name for the node seed a client generates, imports, or exports. Same bytes restore the same PeerId. |

## Discovery & Connections

| Term | Definition |
|------|------------|
| **Peer exchange (PEX)** | Gossip-based protocol for sharing known peer addresses; runs over both broadcast topics and direct streams. |
| **Peer registry** | In-memory record of verified peers the node trusts enough to dial and exchange data with. |
| **Dial queue** | Throttled outbound connection manager; prevents connection storms. |
| **Peer scorer** | Rates peers for dialability, backoff, and connection gating. |
| **Onboarding** | The debounced window after discovery during which a peer is authenticated before entering the registry. |
| **Bootstrap peer** | A well-known peer multiaddr used for initial discovery when mDNS/LAN discovery is unavailable (required for browser clients). |
| **Relay peer** | A Node peer that assists connectivity for peers behind NAT (circuit-relay); distinct from a pure bootstrap address book. |
| **Browser client peer** | A DeChat node running in a browser — typically dial-only over WebSockets/WebRTC, with mDNS disabled. |

## Messaging & Propagation

| Term | Definition |
|------|------------|
| **Broadcast propagation** | Pub/sub messaging via GossipSub — many-to-many topic delivery. |
| **Direct propagation** | Point-to-point messaging over libp2p streams with length-prefixed framing. |
| **Topic** | A named channel on the broadcast layer (e.g. chat room, PEX gossip topic). |
| **Protocol** | A named handler on the direct stream layer (e.g. replication, anti-entropy, auth). |

## Storage & Replication

| Term | Definition |
|------|------------|
| **Content hash** | SHA-256 digest that uniquely identifies a piece of replicated content. |
| **Replica store** | Local persistence for content-addressed payloads (in-memory or LevelDB). |
| **Replication** | The process of distributing content hashes and payloads across the mesh. |
| **K-replica replication** | Partial replication: a node stores content only if it is among the K XOR-closest peers to the hash. |
| **Topic-based replication** | Full replication within a chat topic — every room member eventually holds all room content. |
| **Announcement (ANNOUNCE)** | Gossip broadcast that a node holds a given content hash, prompting pull if missing. |
| **Inflight request** | A deduplicated in-progress fetch for a content hash from a specific peer. |

## Convergence (Anti-Entropy)

| Term | Definition |
|------|------------|
| **Data convergence** | Layer that guarantees eventual consistency by finding and fetching missing content hashes. |
| **Anti-entropy** | Proactive scheduled sync between peers using Merkle trie snapshots instead of raw payloads. |
| **Prefix trie** | Deterministic Merkle prefix tree (16 branches per level) over content hashes for O(1) divergence detection. |
| **Trie-backed replica store** | Decorator around a replica store that maintains the prefix trie on every write and rebuilds it at boot. |
| **Top-N snapshot** | Serialized view of the trie's root and upper branches exchanged during anti-entropy sync. |
| **TOMBSTONE** | Append-only deletion event in the event-sourcing model; preserves CAS immutability while marking content as removed. |

## Architecture

| Term | Definition |
|------|------------|
| **Strategy** | A swappable factory (`DeChatStrategies`) for propagation, replication, store, hashing, or convergence. |
| **Composition root** | `createNode` — the single place where libp2p, networking services, and strategies are wired together. |
| **Platform stack** | Runtime-specific libp2p transports, muxers, encryption, discovery plugins, and listen addrs injected at the composition root (`Libp2pPlatformStack`). |
| **Boot lock** | Requirement that `replicaStore.init()` completes (trie rebuild) before the libp2p network starts. |
| **Handler registry** | Multiplexing pattern allowing multiple independent subscribers on the same broadcast topic or direct protocol. |

## Application

| Term | Definition |
|------|------------|
| **Chat client** | Application-facing participant that joins rooms, sends messages, and projects history. _Avoid_: chat-utility, chat-client package name (the package is `@dechat/chat`) |
| **Chat room** | A conversation whose messages are fully replicated among members that have joined it. |
| **Room ID** | Opaque identifier of a chat room. _Avoid_: topic (the gossip channel derived from a room ID), channel |
| **Chat message** | An application envelope stored as content-addressed payload in a room. |
| **Message projection** | Visible room history obtained by replaying stored events and omitting tombstoned hashes. |
| **Open room** | A chat room with no invite: any verified peer already on this mesh may `joinRoom`. _Avoid_: public room; tying join to infoHash |
| **Display name** | Unsigned nickname a client may attach to outgoing messages. Not identity; PeerId is. _Avoid_: username |
| **Room key** | Symmetric AES-256-GCM secret for one chat room and key epoch. Distributed to members over authenticated direct streams; never stored in the replica store. |
| **Room scope** | Replication layer that confines announce, store, and pull to joined rooms, sitting on top of existing replication strategies. |
| **Capability room** | Invite- or certificate-gated room membership (planned). _Avoid_: private room (ambiguous with E2EE) |
| **Encrypted chat** | Application-layer AES-GCM on message bodies with a per-room key held in the client, not in the replica store. Open-room joiners can obtain the current key. |
