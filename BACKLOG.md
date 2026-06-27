# Backlog items for DeChat repo

**Project:** DeChat (Decentralized Chat Application)  
**Component:** `@dechat/core` (P2P Networking & Replication Engine)  
**Audit Scope:** Distributed Systems Performance, Network Reliability, and Concurrency  
**Status:** Pending Review  

---

## Executive Summary
The core architecture has successfully transitioned to a robust, Dependency-Injection-driven modular system. Interfaces, strategies, and factories are strictly defined. The next phase of development must address edge cases inherent to decentralized distributed systems: preventing CPU/Memory bottlenecks during network storms, handling network partitions, and ensuring deterministic concurrency.

---

## 🏎️ Category 1: Performance & CPU Optimizations

### Task 1.1: Replace JSON Serialization with Binary Formats
* **Severity:** High
* **The Issue:** The `GenericDataSerializer` currently uses `JSON.stringify` and `JSON.parse`. `JSON.parse` is synchronous and blocks the Node.js event loop.
* **The Impact:** In a P2P network, nodes parse hundreds of messages per second during a broadcast storm. If a peer sends a large payload (e.g., 256KB), your node freezes while parsing it, causing latency spikes and dropping other concurrent TCP/WebRTC connections.
* **The Solution:** 1. Migrate the data serialization layer to a binary format.
  2. Implement **Protocol Buffers** (using `protobufjs` or `protons`) or **CBOR** (using `cbor-x`).
  3. Define strict schema boundaries for `PropagatedMessage` to ensure payload sizes are known and validated before allocation.
* **Affected Modules:** `src/data-replication/serializers.ts`, `GenericDataSerializer`

### Task 1.2: Optimize Kademlia XOR Distance Hot-Path
* **Severity:** Medium
* **The Issue:** In `KReplicaContentHashReplication.shouldReplicate`, the node calculates `calculateXorDistance(peer, content)` for *every single known peer* upon receiving *every single incoming message*.
* **The Impact:** `BigInt` instantiation and mathematical comparisons in a high-frequency loop cause extreme CPU churn and trigger aggressive Garbage Collection (GC) pauses.
* **The Solution:** 1. Implement a caching mechanism (e.g., `LRUCache`) for XOR distances. 
  2. Alternatively, pre-calculate distances when a new peer joins the `PeerRegistry`, rather than re-calculating the entire network view dynamically on every message.
* **Affected Modules:** `src/data-replication/KReplicaContentHashReplication.ts`, `shouldReplicate()`

---

## 🛡️ Category 2: Network Reliability & Robustness

### Task 2.1: Implement Background Anti-Entropy Sync (Split-Brain Recovery) - Data convergence - Completed
* **Severity:** High (Critical for Data Consistency)
* **The Issue:** The current `KReplica` strategy is *reactive* (replicating data as it arrives via pubsub). If the network suffers a temporary partition (Split-Brain), nodes on Side A will miss all gossip events from Side B.
* **The Impact:** When the partition heals, nodes will have diverging databases and missing messages, permanently breaking the chat history.
* **The Solution:** 1. Implement a background Anti-Entropy protocol.
  2. Every `X` minutes, nodes should randomly select a peer and exchange a lightweight summary of their database.
  3. Use **Merkle DAGs**, **Vector Clocks**, or **Bloom Filters of stored hashes** to efficiently determine which hashes are missing.
  4. Silently fetch the missing messages via the DHT/Direct Streams.
* **Affected Modules:** `src/data-replication/`, new Anti-Entropy strategy needed.

### Task 2.2: Implement Bloom Filter Rotation in Peer Exchange (PEX)
* **Severity:** Medium
* **The Issue:** PEX uses a Bloom Filter with a 24-hour TTL (`seenPeersBloomFilterTTLMs`) to prevent sending duplicate peer addresses in gossip.
* **The Impact:** Bloom filters suffer from "saturation." As the filter fills up over 24 hours, its false-positive rate spikes. Eventually, the node will stop gossiping peers altogether because it falsely assumes it has already shared everyone.
* **The Solution:** 1. Implement a "Double Filter" (Current and Previous) rotation strategy.
  2. Keep two filters. Every 12 hours, drop the Previous filter, shift the Current filter to Previous, and instantiate a fresh Current filter.
  3. Check both filters before gossiping, but only add new peers to the Current filter.
* **Affected Modules:** `src/networking/PeerExchangeService.ts`

### Task 2.3: Improve Connection Manager using Libp2p version 3.X
* **Severity:** Medium
* **The Issue:** Current core package uses libp2p 2.x.x version and it does not support min_connections config. 
* **The Impact:** Although we have our own min connection strategy implemented by dial queue it will be better to use the libp2p's support for min conneciton as it will be well battle tested. Can make our node more robust.
* **The Solution:** Come up with better Connection Manager strategy (Maintaining min and max connections for each peer) Latest Libp2p version 3.x.x has support for autoDial and minConnections in the connection Manager config check that out.
* **Affected Modules:** `src/networking/DialQueue.ts` `src/node.ts`

---

## 🚦 Category 3: Stream & Concurrency Management

### Task 3.1: Enforce Direct Stream Backpressure & Timeouts
* **Severity:** High (Security / DoS vector)
* **The Issue:** `DirectStreamPropagation` dials peers and writes raw data to streams without explicit time-bounding.
* **The Impact:** A malicious or extremely slow peer (e.g., 50 kbps) can cause your node's outbound buffers to bloat. If you attempt to send a 5MB buffer and the peer reads it at a crawl, that memory sits in your node's RAM. Multiplied by 100 peers, this causes an Out-of-Memory (OOM) crash (Slowloris attack).
* **The Solution:** 1. Wrap `writeToStream` calls with an `AbortController`.
  2. If the stream doesn't flush within a reasonable timeout (e.g., 5 seconds), abort the stream and penalize the peer using `PeerScorer`.
* **Affected Modules:** `src/data-propagation/direct/DirectStreamPropagation.ts`, `src/utils.ts`

### Task 3.2: Prevent Broadcast Halts (`Promise.all` Vulnerability)
* **Severity:** Medium
* **The Issue:** Using `Promise.all()` to fan out network requests to multiple peers.
* **The Impact:** `Promise.all` fails fast. If you are broadcasting to 5 peers and the 1st peer drops the connection (throwing an error), the Promise rejects immediately, and the remaining 4 peers might not get the message or the execution context halts.
* **The Solution:** 1. Audit the codebase for network loops utilizing `Promise.all`.
  2. Replace with `Promise.allSettled()`.
  3. Log the rejected promises individually without breaking the overall fan-out logic.
* **Affected Modules:** `ReplicationMessageProtocolManager.ts`, `PeerExchangeService.ts`

---

## 🔒 Category 4: Security & Future-Proofing

### Task 4.1: Implement End-to-End Encryption (E2EE)
* **Severity:** High (For Application Layer)
* **The Issue:** Libp2p encrypts the *transport* layer (Noise/TLS), meaning ISPs cannot read the traffic. However, middle-man nodes routing the gossip messages *can* read the payload at rest.
* **The Impact:** Zero privacy in a decentralized network; any node replicating the chat data can parse the message contents.
* **The Solution:** 1. Generate asymmetric application keys for users (distinct from Libp2p Network Identity keys).
  2. Encrypt the inner application payload *before* passing it to `GenericDataSerializer`.
  3. The `core` network layer should only route opaque ciphertext blobs identified by a `ContentHash`. 
* **Affected Modules:** App-layer integration (outside of `core`, but `core` must treat payloads as strictly opaque `Uint8Array`s).