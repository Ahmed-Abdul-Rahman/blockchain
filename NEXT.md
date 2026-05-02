# Next Steps (for Future Me)

**Last session:** 2026-29-04
**Branch:** feature/refactor-configs-and-node-initialization

---

## What I just did
Implementing AntriEntropyNetworkExchangeEngine. Need to recheck the dialing and handling of message streams.

## What I am doing

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
- [ ] Instantiate the reactive engine: `const replicationEngine = new KReplicaContentHashReplication(wrappedStore, ...)`.
- [ ] Instantiate the proactive manager: `const antiEntropy = new AntiEntropyManager(replicationEngine, trie, ...)`.
- [ ] Ensure `antiEntropy.start()` and `antiEntropy.stop()` are wired into the node's lifecycle hooks.

## What problem I am solving

I want the peers to have same data across the network, garunteeing eventual consistency, for this we need to implement a data convergence mechanism (Anti-Entropy Prefix Merkle Trie based).

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
