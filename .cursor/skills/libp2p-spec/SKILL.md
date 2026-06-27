---
name: libp2p-spec
description: Reference for the libp2p wire protocols and abstractions that power DeChat — peer ids/keys, multiaddrs, connection upgrade, multistream-select, Noise/TLS security, yamux/mplex muxing, identify, GossipSub (incl. v1.1 peer scoring), kad-dht, mDNS, relay/DCUtR, AutoNAT, hole punching. Use when implementing or debugging anything that crosses the libp2p network boundary.
---

# libp2p Spec Reference

Condensed from the [libp2p technical specifications](https://github.com/libp2p/specs). libp2p is a modular suite of protocols for peer-to-peer applications; this skill captures the language/implementation-independent wire-level facts DeChat depends on.

For DeChat's own wiring of libp2p, use `/libp2p-core-patterns`. For general theory, use `/p2p-fundamentals`.

## Spec index (what exists)

| Area | Specs |
|------|-------|
| **Core abstractions** | addressing (multiaddr), connections & upgrading, peer-ids & keys |
| **Security** | noise, tls (1.3+), plaintext (dev only), secio (legacy), pnet (PSK) |
| **Muxers** | yamux, mplex |
| **Transports** | quic, websockets, webtransport, webrtc / webrtc-direct |
| **Discovery** | kad-dht, mdns, rendezvous |
| **Protocols** | identify (+push), ping, fetch, autonat (v1/v2) |
| **PubSub** | pubsub interface → gossipsub v1.0/v1.1/v1.2/v1.3, episub |
| **NAT traversal** | relay (circuit v1/v2), dcutr, hole-punching |
| **RFCs** | signed-envelopes, routing-records, text peerid-cid |

## Peer IDs and keys

Identity in libp2p is **cryptographic and stable**, distinct from network **location**.

**Key types**: `RSA=0`, `Ed25519=1`, `Secp256k1=2`, `ECDSA=3`. Implementations **MUST** support Ed25519 (DeChat uses Ed25519). Keys are serialized in a protobuf:

```protobuf
enum KeyType { RSA = 0; Ed25519 = 1; Secp256k1 = 2; ECDSA = 3; }
message PublicKey  { required KeyType Type = 1; required bytes Data = 2; }
message PrivateKey { required KeyType Type = 1; required bytes Data = 2; }
```

Protobuf encoding must be **deterministic**: minimal varints, fields in tag order, all fields present, no extras. Private keys are **never** sent over the wire.

**Ed25519 encoding notes:**
- Public key: no extra encoding (raw 32 bytes).
- Private key preferred form: `[private bytes][public bytes]` (64 bytes). Older form `[private][public][public]` (96 bytes) — verify the two public-key copies match, else reject.

**Deriving a peer id:**
1. Encode the public key (protobuf above).
2. If serialized length **≤ 42 bytes** → use the **identity** multihash (no hashing; Ed25519 falls here → `12D3Koo...`).
3. If **> 42 bytes** → **SHA-256** multihash.

**String forms** (both MUST be parseable):
- Legacy: bare base58btc multihash (`Qm...`, `1...`, `12D3Koo...`)
- New: CIDv1 with `libp2p-key` multicodec (`0x72`), base32 multibase (`bafz...`)

## Addressing (multiaddr)

A **multiaddr** is a self-describing, composable sequence of `(protocol, value)` components — transport-agnostic.

```
/ip4/198.51.100.0/tcp/1234              # TCP/IP
/ip4/1.2.3.4/udp/4001/quic-v1           # QUIC over UDP
/dns4/example.com/tcp/443/wss           # secure WebSocket
/ip4/.../tcp/1234/p2p/12D3Koo...        # location + identity
/p2p/QmRelay/p2p-circuit/p2p/QmTarget   # relayed address
```

- **Encapsulation** stacks layers (`/ip4/.../tcp/...`); each lower protocol comes first.
- The **`/p2p/<peer-id>`** component binds a location to an identity. Exchanged addresses include it.
- `/dnsaddr` resolves to other multiaddrs via DNS TXT, used for bootstrap nodes.

## Connection establishment & upgrade

A **connection** = reliable, bidirectional, **secure**, **multiplexed** channel between two peers. **Streams** are multiplexed over it, support **backpressure** and **half-close**.

Terminology: **dial** = initiate outbound; **listen** = accept inbound. **Initiator** vs **Responder**.

Some transports (QUIC) bundle security + muxing. "Raw" transports (TCP) need an **upgrade**:

1. Both peers speak **multistream-select** (`/multistream/1.0.0`) to negotiate protocols.
2. Negotiate **security first** (Noise/TLS) — handshake; abort on failure.
3. Over the encrypted channel, negotiate the **stream multiplexer** (yamux/mplex).
4. Connection is ready; open application streams.

**multistream-select**: messages are UTF-8 + `\n`, prefixed with their unsigned-varint byte length. Initiator proposes a protocol id; responder echoes it (agree) or replies `"na"` (not available). Example: `"na"` on the wire = `0x036e610a`.

**Protocol ids** are path-like with versions: `/yamux/1.0.0`, `/meshsub/1.1.0`, `/ipfs/id/1.0.0`. Default routing is exact literal match; a custom match function enables flexible matching. Concurrent simultaneous-open (NAT hole punching) is tie-broken via the [simopen] extension.

**Baseline interop stack:** security = **Noise** (universally supported), muxer = **yamux**.

## Security handshakes

- **Noise** (`/noise`) — the recommended baseline. XX handshake pattern; authenticates peer ids and establishes an encrypted channel. Supported in all implementations.
- **TLS 1.3** (`/tls/1.0.0`) — uses a libp2p extension carrying a signed certificate that binds the TLS key to the peer id.
- **plaintext** (`/plaintext/2.0.0`) — **no encryption**, dev/testing only.
- **pnet** — pre-shared-key private networks (XSalsa20), wraps the raw transport before upgrade.

## Stream multiplexers

- **yamux** — recommended; flow-controlled (windowed backpressure), simple API.
- **mplex** — older, no flow control; being phased out.

## identify (`/ipfs/id/1.0.0`) and identify/push (`/ipfs/id/push/1.0.0`)

Exchanges peer info. The `Identify` message:

```protobuf
message Identify {
  optional string protocolVersion = 5;   // protocol family, e.g. "/my-net/0.1.0"
  optional string agentVersion    = 6;   // "agent-name/version"
  optional bytes  publicKey       = 1;    // marshalled per peer-ids spec
  repeated bytes  listenAddrs     = 2;    // multiaddrs the peer listens on
  optional bytes  observedAddr    = 4;    // YOUR address as seen by them (NAT inference)
  repeated string protocols       = 3;    // protocols this peer accepts inbound
}
```

- `identify` = pull (open stream, peer returns its info, closes).
- `identify/push` = proactive update on change (e.g. new listen addr). Missing fields are ignored → partial updates allowed.
- `observedAddr` lets a node infer it's behind a NAT and learn its public address.
- Only advertise a protocol in `protocols` if you'll accept inbound streams for it (matters for asymmetric request/response protocols).

## PubSub & GossipSub

`pubsub` is the publish/subscribe interface; **GossipSub** (`/meshsub/1.x.0`) is the production implementation DeChat uses for broadcast propagation.

**Core model:** for each topic, a peer maintains a **mesh** of full-message peers (target degree `D`, bounds `D_low`/`D_high`). Messages flow eagerly to mesh peers; **gossip** (IHAVE/IWANT metadata) flows lazily to non-mesh peers so they can pull missed messages. Mesh membership is managed with **GRAFT** (join) and **PRUNE** (leave) control messages on a **heartbeat**.

### GossipSub v1.1 security extensions (`/meshsub/1.1.0`)

Backwards-compatible additions over v1.0 to resist attacks and improve bootstrapping:

- **Explicit peering** — operator-specified peers kept connected unconditionally, outside the mesh and scoring. GRAFT on them is an error.
- **PRUNE backoff + Peer Exchange (PX)** — when pruning due to oversubscription, the pruner may hand the prunee a set of alternative peers (`> D_high`) so it can reform its mesh without external discovery. Both add a **backoff** (recommended 1 min); regrafting too early is penalized.
- **Flood publishing** — publisher sends to all topic peers above the publish threshold, not just its mesh.
- **Adaptive gossip dissemination** — gossip factor scales with topic peer count.
- **Outbound mesh quotas** — keep a minimum of outbound-initiated connections in the mesh (anti-eclipse).
- **Peer scoring** — each peer locally scores others; mesh decisions use thresholds. The score combines per-topic and global parameters:

  | Param | Meaning |
  |-------|---------|
  | P₁ | Time in mesh (capped positive) |
  | P₂ | First message deliveries (rewards fast forwarders) |
  | P₃ / P₃b | Mesh message delivery rate / deficit (penalty) |
  | P₄ | Invalid messages (strong penalty) |
  | P₅ | Application-specific score |
  | P₆ | IP colocation factor (penalty for many peers on one IP) |
  | P₇ | Behavioural penalty (e.g. early regraft) |

  Parameters **decay** over time. **Extended validators** let the application return `ACCEPT`/`REJECT`/`IGNORE` for each message, feeding P₄.

> DeChat parallels this with `SimplePeerScorer`. When tuning GossipSub or interpreting mesh churn, reason in terms of these parameters and thresholds.

## Discovery

- **kad-dht** (`/ipfs/kad/1.0.0`) — Kademlia DHT: XOR distance, k-buckets, iterative `FIND_NODE`/`GET`/`PUT`. Used for peer routing and content/provider records. RSA support helps interop with the public IPFS DHT.
- **mdns** — zero-config **local** discovery via multicast DNS; peers announce on the LAN. DeChat uses this for local-network bootstrap.
- **rendezvous** — a rendezvous point where peers register/discover under namespaces; good for topic-scoped discovery without a full DHT.

## NAT traversal

- **AutoNAT** (v1/v2) — peers help each other determine whether they are publicly **dialable**; combined with `observedAddr` from identify to learn reachability.
- **Circuit Relay v2** (`/libp2p/circuit/relay/0.2.0/*`) — a relay forwards traffic between peers that can't connect directly (TURN-like). Reservations + limited relayed connections. Relayed multiaddrs look like `/p2p/QmRelay/p2p-circuit/p2p/QmTarget`.
- **DCUtR** (`/libp2p/dcutr`, Direct Connection Upgrade through Relay) — peers first connect via relay, then coordinate **hole punching** (synchronized simultaneous dial) to upgrade to a direct connection.

## Signed records (RFCs)

- **Signed envelopes** — a domain-separated, typed, signed wrapper (`PublicKey`, payloadType, payload, signature) for authenticated data.
- **Routing records** — a peer's signed set of addresses (PeerRecord), so address info can be relayed by third parties without forgery.

## Connection state management (recommendations)

- Keep a **peerstore**: at minimum peer id + last-known-good addresses (memory and/or persistent) to rejoin quickly without relying on bootstrap each time.
- Enforce **connection limits** with a prioritization/trim policy for "expendable" connections.
- Scope supported protocols to the physical connection; a node MAY offer different protocols per peer and change them at runtime → don't assume the protocol set is static.
- Emit **connection lifecycle events**: `Connected`, `Disconnected`, `OpenedStream`, `ClosedStream`, `Listen`, `ListenClose`.

## DeChat relevance map

| libp2p spec | DeChat usage |
|-------------|--------------|
| peer-ids / Ed25519 | Node identity from seed; `PeerAuthenticator` |
| connections / upgrade | Transport setup in `createNode` |
| Noise / yamux | Default secure muxed channel |
| identify | Peer capability/address exchange |
| GossipSub v1.1 | `GossipSubPropagation` (broadcast layer) |
| mDNS / kad-dht | Discovery + `PeerExchangeService` |
| peer scoring | `SimplePeerScorer` |
| direct streams | `DirectStreamPropagation` (custom protocol ids) |

## Related skills

| Skill | Use for |
|-------|---------|
| `/libp2p-core-patterns` | How DeChat actually wires these in `@dechat/core` |
| `/p2p-fundamentals` | Underlying DHT/replication/chunking theory |
| `/designing-p2p-systems` | Choosing consistency/replication strategies |
