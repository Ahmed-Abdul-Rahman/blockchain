# Next Steps (for Future Me)

**Last session:** 2026-29-04
**Branch:** feature/refactor-configs-and-node-initialization

---

## What I Just did:
Built the Anti-Entropy Sync Mechanism (Phases 1-4): Designed and implemented the complete Data Convergence layer to guarantee eventual consistency across the P2P network.

Implemented the Merkle Prefix Trie: Created a deterministic, O(1) comparison tree (PrefixTrie) to identify exactly which 64-char sha256 message hashes are missing between two peers without transmitting the actual data.

Built the Bidirectional RPC Network Engine: Created the AntiEntropyNetworkExchangeEngine using libp2p streams and setupRPCStream to allow two nodes to recursively ping-pong "Top-N" and "Branch" snapshots to isolate missing data.

Resolved Critical Architectural Paradoxes: * Switched from K-Closest Partial Replication to Topic-Based Full Replication (TopicBasedContentHashReplication) so chat histories fully mathematically converge for everyone in a room.

Switched to Append-Only / Event Sourcing (using TOMBSTONE events) to handle message deletions, preserving the immutability of the Content-Addressable Storage (CAS) and Merkle Trie.

## What I am doing:
Finalizing Phase 5 (Top-Level Wiring): Connecting the new AntiEntropyManager, PrefixTrie, and TopicBasedContentHashReplication engines into the main Node instantiation (nodeFactory.ts) using Dependency Injection.

Implementing the Handler Registry Pattern: Refactoring the GossipSubPropagation and DirectStreamPropagation layers to act as local multiplexers (using Map<string, Set<Function>>). This ensures the UI, Storage Engine, and Notification systems can all independently subscribe to the same chat topics/streams without overwriting each other.

Enforcing Strict Boot Locks: Wrapping the database in a TrieBackedReplicaStore decorator that strictly rebuilds the Merkle Trie into memory before the libp2p network is allowed to start.

## What Overall Problems I am solving:
Decentralized Eventual Consistency: Solving the "Offline Peer" problem. If Node A goes offline and misses 50 messages, the Anti-Entropy manager guarantees it will cleanly and efficiently sync the exact missing state from Node B upon reconnecting.

Network & Bandwidth Efficiency: Using cryptographic Merkle snapshots instead of sending raw data, ensuring nodes only spend bandwidth downloading chat messages they definitively do not have.

P2P Architectural Purity: Building a true serverless mesh where the Networking layer (libp2p), the Storage layer (LevelDB/Merkle Tries), and the Application logic are completely decoupled, predictable, and robust against network churn or malicious data loops.

Implementing Anti-Entropy Mechanism. Below is the plan

### Phase 1: Core Data Structure (The Merkle Prefix Trie)
- [x] Create `packages/core/src/data-convergence/types.ts` for serialized Trie node representations.
- [x] Create `packages/core/src/data-convergence/PrefixTrie.ts`.
- [x] Implement hex-character routing (16 branches per node for sha256).
- [x] Implement `insert(hash: string)`: Incrementally updates branch hashes up to the root.
- [x] Implement `getTopN(levels: number)`: Returns a serialized representation of the root and top `N` levels.
- [x] Implement `findMismatches(remoteTopN)`: Compares local tree against remote payload to yield divergent prefixes/hashes.

### Phase 2: State Synchronization & Eager Initialization
- [ ] Update `ReplicaStoreInterface` (`packages/core/src/replica-store/types.ts`) to include an async key iterator: `getAllKeys(): AsyncIterable<string>`.
- [ ] Implement `getAllKeys()` using streaming/chunking in `LevelDbReplicaStore` and `InMemoryReplicaStore` to prevent memory spikes.
- [ ] Create `packages/core/src/data-convergence/TrieBackedReplicaStore.ts` (Decorator pattern).
- [ ] Implement "Eager Rebuild" in `TrieBackedReplicaStore`'s initialization method to pump `getAllKeys()` into the Trie.
- [ ] Implement `put()` override in the decorator to save to DB, then synchronously `insert()` into the Trie.

### Phase 3: Network Exchange Protocol
- [ ] Define protocol string: `/deChat/v1/anti-entropy/1.0.0` (likely in `packages/core/src/networking/configurations.ts`).
- [ ] Create `packages/core/src/data-convergence/AntiEntropyNetworkExchange.ts` to handle the libp2p direct stream registration and handler.
- [ ] Define serialization/deserialization logic for the Top-N batch payload (using CBOR/Protobuf or existing JSON serializers).
- [ ] Implement the stream handler: Read remote Top-N -> compare with local Trie -> respond with a requested list of exactly which full hashes are missing.

### Phase 4: Decoupled AntiEntropyManager
- [ ] Create `packages/core/src/data-convergence/AntiEntropyManager.ts`.
- [ ] Inject dependencies via Standard Constructor Injection: `PeerRegistry`, `AntiEntropyNetworkExchange`, `PrefixTrie`, and `DataReplicationInterface`.
- [ ] Implement the background scheduler (`setInterval` based on config).
- [ ] Implement proactive sync logic: Pick random connected peer -> perform Top-N exchange -> receive list of missing hashes.
- [ ] Delegate fetching: Loop through the missing hashes and call `await this.dataReplication.requestMissingData(hash, syncPeerId)` to fetch them silently.

### Phase 5: Top-Level Wiring (IoC)
- [ ] Update node instantiation (`packages/core/src/node.ts` or relevant factory).
- [ ] Wrap the user's configured store: `const wrappedStore = new TrieBackedReplicaStore(baseStore, trie)`.
- [ ] Instantiate the reactive engine: `const replicationEngine = new TopicBasedContentHashReplicaiton(wrappedStore, ...)`.
- [ ] Instantiate the proactive manager: `const antiEntropy = new AntiEntropyManager(replicationEngine, trie, ...)`.
- [ ] Ensure `antiEntropy.start()` and `antiEntropy.stop()` are wired into the node's lifecycle hooks.


## What to do next (in order)
Refer [BACKLOG](BACKLOG.md) for backlog items what can be picked next.

## Random Improvements/Enhancements/TODO List
- Improve code coverage to 80% by adding more test scenarios or improving existing testcase to cover more code lines.
- Make Integration tests more configurable (Ex: Control No Of nodes, duration, env variables)
- Verify and Ensure incase of worker thread crashes or any other issues, the integration test harness should always teardown and terminate.
- Add coverage tooling and enforce minimal thresholds in CI.
- Add soak/fuzz tests for malformed gossip/stream payloads.
- Introduce load/perf benchmark scripts and baseline target metrics.

## Open questions / decisions

- Where to store the node seed and how to load it? (private key or node seed to revive the peer incase it crashed)
- Should add a design diagram for the Core package's implementation and working
- Come up with more integration/inter-op tests for the core packge to ensure its reliability and stability.
