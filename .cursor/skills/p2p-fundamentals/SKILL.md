---
name: p2p-fundamentals
description: Core peer-to-peer networking concepts for building decentralized systems — P2P models, peer discovery, DHT/Kademlia, content addressing, chunking, replication, churn, and CAP trade-offs. Use when reasoning about P2P design fundamentals, onboarding to decentralized networking, or grounding DeChat decisions in established theory.
---

# P2P Fundamentals

Consolidated core concepts for building reliable, scalable, efficient peer-to-peer systems. Sourced from [awesome-p2p](https://github.com/mafintosh/awesome-p2p), [p2p-workshop](https://github.com/mafintosh/p2p-workshop), [bugfree.ai P2P system design](https://medium.com/@bugfreeai/system-design-beginners-guide-designing-a-peer-to-peer-network-707a5aa46238), [Simson M on P2P architecture](https://simsonmoses.medium.com/peer-to-peer-p2p-architecture-decentralized-by-design-3f73e37048fd), and [ByteByteGo Crash Course in P2P](https://blog.bytebytego.com/p/a-crash-course-in-p2p).

For DeChat-specific design, use `/designing-p2p-systems`. For libp2p wire details, use `/libp2p-spec`.

## What a P2P network is

Every **node** acts as both client and server. No central authority. Nodes share resources (data, bandwidth, compute) directly. Contrast with client-server, where all traffic flows through a central server.

| Property | Client-Server | P2P |
|----------|---------------|-----|
| Control | Centralized | Distributed |
| Failure point | Single (server) | None inherent |
| Scaling | Server-bound | More peers = more capacity |
| Consistency | Easy (one source of truth) | Hard (no single truth) |

## P2P models

| Model | Discovery | Examples | Notes |
|-------|-----------|----------|-------|
| **Pure / unstructured** | Flooding, random connections | Gnutella, early file-sharing | Simple; lookups are expensive (broadcast) |
| **Structured** | Algorithmic placement via DHT | BitTorrent Mainline DHT, IPFS | O(log n) lookups; needs routing tables |
| **Hybrid** | Central bootstrap + P2P transfer | Skype (legacy), most blockchains | Central coordination only for bootstrap/discovery |

DeChat is **structured** (libp2p mesh, XOR distance, GossipSub) with **hybrid bootstrap** (mDNS + bootstrap nodes, then PEX gossip).

## Node lifecycle

### Node identity

A node is identified by a **node triple**: `(IP address, port, node ID)`. The node ID must be globally unique with no collisions. Common approaches:

- Random number generated at install
- Hash of a public key (DeChat: Ed25519 public key → peer id)

Identity should be **stable and verifiable**, separate from **location** (which can change). See `/libp2p-spec` addressing.

### Node initialization & bootstrap

A fresh node knows nothing about the network. Bootstrap options:

1. **Hard-coded trusted nodes** — a default list shipped in the client (Bitcoin-style)
2. **Bootstrap servers** — well-known stable peers
3. Once connected, the node discovers more peers and no longer needs the bootstrap list

> "The hard-coded list is just a bootstrap; once the client has a few nodes connected it doesn't need the original list anymore."

## Peer discovery

| Method | How | Trade-off |
|--------|-----|-----------|
| **Central server / tracker** | One server lists active peers | Simple; reintroduces a central point (hybrid model) |
| **DHT (Distributed Hash Table)** | Decentralized key→peer mapping, O(log n) lookups | No central point; more complex |
| **Broadcast / multicast** | Announce presence locally (e.g. mDNS) | Works only on local networks |
| **Peer exchange (PEX)** | Peers gossip known peers to each other | Scales without external discovery service |

DeChat combines mDNS (local), bootstrap (initial), and PEX gossip (ongoing).

## Distributed Hash Tables (DHT) & Kademlia

A DHT maps **keys** (file/content/user IDs) to **values** (peer locations), spread across all peers — each peer owns a slice of the key space. Lookups are **O(log n)**.

### Kademlia (Maymounkov & Mazières, 2002)

The most influential DHT (BitTorrent Mainline, IPFS, libp2p kad-dht).

**XOR distance metric** — distance between two IDs is `id_a XOR id_b` interpreted as an integer. Properties:

- **Symmetry**: `d(A,B) = d(B,A)`
- **Identity**: `d(A,A) = 0`
- **Triangle inequality**: `d(A,C) ≤ d(A,B) + d(B,C)`

**Routing table / k-buckets** — table split into buckets by distance. Bucket `i` holds up to `k` contacts (typically k=20) for peers whose distance falls in `[2^i, 2^(i+1))`. Peers know a lot about close nodes, little about far ones — exponentially decreasing knowledge → O(log n) reachability.

**Lookup process:**
1. Find the `k` closest peers to the target in your own table
2. Query them in parallel for *their* closest peers to the target
3. Iteratively refine — query newly discovered closer peers
4. Terminate when no closer peers are found

**Joins**: a new node looks up its own ID — this fills its routing table and informs others. **Departures**: lazy — peers discover dead nodes via failed pings and evict them. This makes Kademlia resilient to **churn**.

> DeChat uses XOR distance (`@dechat/crypto`) for K-replica peer selection, the same metric Kademlia uses.

## Content addressing & data integrity

- **Content hash** — identify data by `hash(data)` (SHA-256). Deterministic, collision-resistant, globally unique.
- **Integrity verification** — on receipt, recompute the hash and compare. Mismatch → discard and re-fetch from another peer. Essential when peers are untrusted.
- **Signatures** — sign data with a private key so receivers can verify origin.

> When receiving data from untrusted peers, **always verify** by hash and/or signature before storing.

## File chunking & transfer

Large data is split into **chunks** (pieces), each independently hashed.

**Why chunk:**
- **Parallel downloads** from many peers simultaneously
- **Reliability** — a failed peer costs only one chunk, not the whole file
- **Share while downloading** — completed chunks can be served immediately, multiplying bandwidth
- **Fault tolerance** — already-downloaded chunks are safe

**Chunk size trade-off:**
- Smaller (256 KB): more parallelism, faster failure recovery, but more metadata + connections
- Larger (4 MB): less overhead, but less parallelism and slower recovery
- Common sweet spot: ~1 MB

**Rarest-first strategy** (BitTorrent) — download the least-common chunks first:
- Prevents the "last piece" problem (rare chunks vanishing with their few holders)
- Reduces dependence on the original seeder
- Improves overall network health

## Replication & redundancy

- Replicate each chunk across multiple peers (common replication factor: **3**)
- A DHT/index tracks which peers hold each chunk
- When a holder goes offline, trigger **re-replication** to restore the factor
- More copies = more resilience to churn, at the cost of storage/bandwidth

## Routing & lookup

Every node keeps a **routing table** of the closest peers it knows `(IP, port, ID)`. To find data:
- If the node has it → return it
- Else → forward the query to the closest node in its table
- Repeat recursively until the holder is found (O(log n) hops)

## Core APIs (conceptual surface)

| Category | Operations |
|----------|-----------|
| Peer management | `joinNetwork`, `leaveNetwork`, `discoverPeers`, `getPeerInfo` |
| Data sharing | `shareFile`, `searchFile`, `requestFile`, `receiveChunk`, `verifyIntegrity` |
| Security | `generateKeyPair`, `encrypt`, `decrypt`, `sign`, `verifySignature` |

## Distributed data stores (no central DB)

| Store | Purpose |
|-------|---------|
| **Peer registry** | Active peers: ID, address, port, last-seen, status |
| **Content/file metadata** | ID (content hash), size, origin, chunk count, overall hash |
| **Chunk index** | Maps `(content ID, chunk index)` → peers holding it |
| **Reputation store** (optional) | Trust scores from peer behavior |

## Key trade-offs

| Tension | Notes |
|---------|-------|
| **Decentralization vs efficiency** | Full DHT removes central points but lookups are slower; hybrid bootstrap is a common compromise |
| **Redundancy vs storage** | Higher replication factor = more availability, more storage/bandwidth |
| **Security vs performance** | Encryption + signature verification add latency/CPU |
| **Consistency vs availability** (CAP) | Most P2P systems choose **availability + eventual consistency** during partitions |
| **Chunk size** | Parallelism vs metadata/connection overhead |

## Failure scenarios to design for

| Scenario | Effect | Mitigation |
|----------|--------|-----------|
| **Node churn** | Stale routing/index tables, failed lookups | Replication, periodic table refresh, lazy eviction |
| **Network partition** | Isolated groups can't reach each other's data | Eventual reconciliation (anti-entropy) when partitions heal |
| **Insufficient replication** | Chunk lost if all holders leave | Maintain adequate replication factor |
| **Malicious peers** | Corrupt/fake data, refuse to serve | Hash verification, signatures, reputation |
| **Hotspots** | Popular content overloads few peers | Caching, load spreading, rarest-first |
| **Slow discovery** | High latency finding data | Efficient DHT, warm routing tables |

## Non-functional requirements checklist

When designing a P2P system, define:

- [ ] **Scalability** — more peers should add capacity, not bottlenecks
- [ ] **Security** — encryption in transit, resilience to malicious actors
- [ ] **Redundancy/availability** — replication so data survives peer loss
- [ ] **Performance** — acceptable latency/throughput
- [ ] **Fairness** — no peer monopolizes resources (contribute ∝ consume)

## When P2P fits (and when it doesn't)

**Good fit:** file distribution, decentralized apps, censorship-resistant/trustless systems, collaborative compute, encrypted messaging.

**Poor fit:** strict-consistency systems (banking ledgers needing linearizability), real-time systems needing central coordination, scenarios requiring central regulatory control.

## How this maps to DeChat

| Fundamental | DeChat realization |
|-------------|--------------------|
| Structured P2P + hybrid bootstrap | libp2p + mDNS + bootstrap + PEX |
| Node identity from key | Ed25519 keypair from node seed → peer id |
| XOR distance / Kademlia | `@dechat/crypto` XOR for K-replica selection |
| Content addressing | SHA-256 content hashes, CAS replica store |
| Integrity verification | Hash check on received content |
| Replication factor | K-replica (partial) + topic-based (full) |
| Churn resilience | PEX, anti-entropy reconciliation |
| Eventual consistency (CAP-AP) | Anti-entropy + Merkle prefix trie |
| Reputation | `SimplePeerScorer` |

## Related skills

| Skill | Use for |
|-------|---------|
| `/designing-p2p-systems` | DeChat consistency/replication design decisions |
| `/libp2p-spec` | Wire protocols, transports, security handshakes |
| `/p2p-design-patterns` | Node lifecycle, event handling, state management patterns |
