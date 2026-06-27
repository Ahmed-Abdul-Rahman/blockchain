# History of all the Functionality and Changes made to this repo

Used to keep track of what was implemented.

---

**Last session:** 2026-27-06
**Branch:** feature/data-convergence-strategy

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

---

**Last session:** 2026-29-04
**Branch:** feature/refactor-configs-and-node-initialization

---

## What I just did
- Made KContentHashReplication implementation robust by allowing data replication to happen by using the announce-request mechanism rather than directly replicaing, added requestMissingData, utilized kReplicaContent to store only limited replica's of content across peers.
- Implemented XOR based deterministic mechanism to store replicated data, so a peer can decide if should store this data or not.
- Implemented ReplicationMessageProtocolManager to delegate the network part for data replication, so KContentHashReplication can focus on data replication alone.
- Refactored the entire Core package to a fully modular, Dependency-Injection driven with Inversion of Control driven Architecture with Factory pattern, strategy pattern and interface contracts.
- Now, the refactored version of the core package closely aligns with the js-libp2p's architecture of factory and strategy pattern.
- All the strategies (Data propagation, Data replication, Replica Storage, Serializers) are now pluggable.
- Add more unit tests for each implementation classes, added DHT based requestMissingData interOp testcase
- Added vite test coverage to know the overall test coverage of the code.
- Refactored the entire configuration mechanism to handle multiple config values (delays, timers, counts, replica counts, protocols, topics, etc) - moved all the configs to a dedicated single DeChatConfig source, with default configurations.
- Implemented lifecycle methods (start, stop) using the libp2p's Startable interface for the class that seemed to be having a lifecycle functionality.

## What I am doing
- Refactoring the Core package to be moduler and follow strategy and factory patterns.
- Improving and optimizing the data replication mechanism, by not overwhelming the network with too many replication requestions, using XOR based deterministic mechanism to decide which peer can replicate.
- Adding more unit tests.

## What problem I am solving
- Making the core package modular so we can add more modules(Anti-entropy mdoule) and functionality easily
- Must have a common dedicated configuration mechanism to handle all the config values.
- Data replication should be more optimized, to handle too many replication requests all at once from other peers on the network.

---

**Last session:** 2026-07-02
**Branch:** feature/data-replication

---

## What I did

- Refactored DataPropagationInterface and split it into two categories (broadcast and direct)
- Created DirectPropagationInterface and DirectStreamPropagation class for implementation.
- Modified interop test for adding DirectStreamPropagation test
- Renamed DataPropagationInterface to BroadcastPropagationInterface.
- Implemented data replication strategy and replica storage strategy.
- Added testcases for data replication.


## What I was doing
Implement data replication and data propagation mechanism between peers in the network. (This should be an in-built functionality of the core package, and implement it as a layer on top of the existing core implementation. It should be pluggable i.e replaceable with another data replication and propagation mechanism)

## What problem I was solving

- Adding data propagation mechanisms
- Adding data replicatiom mechanisms


**Session:** 2026-26-01  
**Branch:** improvements/optimizing-code, metrics/basic-implementation, refactoring/peer-discovery

## What I just did

- Refactored code, organizing the core package folder to make it a layered architecture implementation.
- Simplified the node.ts createNode method.
- Moved the core p2p network logic to networking folder.
- Added Basic Metrics implementation for core classes.
- Refactored Peer discovery logic and moved it to a seperate PeerDiscoveryManager Class.
- Created DataPropagationInterface and added a GossipSubDataPropagation implementation.
- Added another interop test for GossipSubDataPropagation implementation using the nodeWorkerDataProp

**Session:** 2025-12-07
**Branch:** InterOp/Adding-interoperability-tests

- Implemented p2p integration tests by leveraging worker threads added three scenarios (Burst Startup of peers, Staggered startup and Network Stability peer churn (did peer revived, restored and connected to network))
- Updated dialQueue logic to maintain minimum connections with other peers
- Added some support to restore the peer node's id and details if the node gets restarted.
- Added Github CI with unit-tests and integration-tests jobs
- Migrated from eslint and prettier to biomeJs, replaced husky with lefthook and replaced lodash with es-toolkit


**Session:** 2026-18-01  
**Branch:** improvements/optimizing-code

- Integration with node.ts

Added authenticatinPeers Set data, to avoid authenticating with the same peer
Returns a complete NodeComponents interface with all services accessible
Replaced Map objects with LRUCache in PeerExchangeService and auth

- Metrics & Observability System

MetricsCollector: Tracks connections, peers, dial queue, performance, PEX, and pubsub metrics
HealthChecker: Three-tier health status (HEALTHY/DEGRADED/UNHEALTHY) with configurable thresholds
Prometheus export format for production monitoring
Periodic collection with configurable intervals

- Enhanced Test Output

TestReport interface with detailed metrics summaries
Formatted console output with P50/P95/avg percentiles
Clear pass/fail indicators with specific threshold failures
Applied to all three test scenarios