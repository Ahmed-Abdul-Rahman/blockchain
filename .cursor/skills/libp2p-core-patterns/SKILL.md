---
name: libp2p-core-patterns
description: Implementation patterns for DeChat's libp2p P2P engine in @dechat/core. Use when wiring nodes, adding propagation/replication/convergence features, debugging peer connections, or extending DeChatStrategies — covers createNode, auth, PEX, GossipSub, direct streams, and interop tests.
---

# libp2p Core Patterns (DeChat)

How to implement and extend `@dechat/core` correctly. Read `.cursor/PROJECT.md` for commands and anchors. For architectural trade-offs, use `/designing-p2p-systems`.

## Package map

```
packages/core/src/
├── node.ts                    # Composition root — createNode()
├── config/                    # DeChatConfig, DECHAT_DEFAULTS
├── networking/                # Auth, PEX, dial queue, registry, discovery
├── data-propagation/
│   ├── broadcast/             # GossipSubPropagation
│   └── direct/                # DirectStreamPropagation
├── data-replication/          # K-replica, topic-based, protocol manager
├── data-convergence/          # PrefixTrie, anti-entropy, TrieBackedReplicaStore
├── replica-store/             # InMemory, LevelDB
├── shared/                    # serializers, streamUtils, types
└── types.ts                   # DeChatComponents, DeChatStrategies, DeChatFactory
```

Supporting packages: `@dechat/crypto` (Ed25519, sha256, XOR distance), `@dechat/common` (logger).

## Composition root: createNode()

All features wire through `createNode(infoHash, nodeSeed, config?, strategies?)`.

**Startup order (boot lock):**

```
createNode()
  → resolveConfig() + derive Ed25519 keypair from nodeSeed
  → createLibp2p({ tcp, noise, yamux, mdns?, bootstrap?, gossipsub, identify })
  → wire networking services (scorer, registry, dialQueue, pex, auth, discovery)
  → instantiate DeChatStrategies factories → components.strategies
  → optionally wrap replicaStore in TrieBackedReplicaStore

start():
  1. await replicaStore.init()     ← trie rebuild BEFORE network
  2. start auth, discovery, registry, pex, dialQueue, libp2p
  3. start Startable strategies (replication, anti-entropy, etc.)

stop(): reverse order
```

**Rule:** New behaviour plugs in via `DeChatStrategies` factories — avoid editing `node.ts` internals unless wiring a new strategy slot.

## Strategy injection pattern

```typescript
// types.ts
export type DeChatFactory<T> = (components: DeChatComponents) => T;

export interface DeChatStrategies {
  broadcast?: DeChatFactory<BroadcastPropagationInterface>;
  direct?: DeChatFactory<DirectPropagationInterface>;
  replicaStore?: DeChatFactory<ReplicaStoreInterface>;
  contentHasher?: DeChatFactory<ContentHashStrategyInterface>;
  replicationProtocol?: DeChatFactory<ReplicationProtocolInterface>;
  dataReplication?: DeChatFactory<DataReplicationInterface>;
  networkExchanger?: DeChatFactory<AntiEntropyNetworkExchange>;
  antiEntropyManager?: DeChatFactory<AntiEntropyManager>;
}
```

Reference wiring for tests: `packages/core/tests/interop/childThread/workerUitls.ts` → `configureNode()`.

## Non-negotiable constraints

1. **Auth first** — `PeerRegistry` only via `PeerExchangeService.addPeers()` after `PeerAuthenticator` succeeds
2. **Throttled dialing** — `DialQueue.enqueue()`, never ad-hoc dial loops; `connectionGater` uses scorer
3. **Boot lock** — `replicaStore.init()` before libp2p start when using trie-backed stores
4. **Worker teardown** — interop tests must call `terminateWorkers()` or CI hangs

## Peer lifecycle

```
libp2p 'peer:discovery'
  → PeerDiscoveryManager (debounced onboarding window)
  → PeerAuthenticator.runAuthClient(peerId)
      → dial auth protocol, sign nonce (Ed25519), verify response
  → on success:
      → pexService.addPeers() → peerRegistry.upsertMany()
      → pexService.initiatePeerExchange()
      → dialQueue.enqueue(peer)
```

Inbound auth: `PeerAuthenticator.handleIncomingAuth` — validates timestamp, nonce replay cache (LRU), Ed25519 signature.

## Propagation layers

### Broadcast (GossipSubPropagation)

- `subscribe(topic, handler)` / `publish(topic, message)`
- Handler registry: `Map<string, Set<MessageHandler>>` — multiple subscribers per topic
- Per-topic LRU dedup, size limits
- Use for: PEX gossip, ANNOUNCE, chat topic messages

### Direct (DirectStreamPropagation)

- `onReceive(protocol, handler)` / `send(peerId, protocol, message)`
- Length-prefixed framing via `shared/streamUtils.ts`
- Handler registry multiplexing
- Use for: replication REQUEST/CONTENT, anti-entropy RPC, auth

**Do not overwrite handlers** — always use subscribe/onReceive registry pattern.

## Replication flow

```
Local data:
  dataReplication.onLocalDataProduced(data)
    → contentHasher.hash(data)
    → replicaStore.put(hash, bytes)
    → replicationProtocol.announceToNetwork(hash)   // gossip ANNOUNCE

Remote ANNOUNCE:
  ReplicationMessageProtocolManager.handleAnnounce()
    → delegate.onPeerAnnounced() → send REQUEST if not stored & not inflight

Remote REQUEST:
  → serve CONTENT or ERROR from local store

Missing data (anti-entropy trigger):
  dataReplication.requestMissingData(hash, peerId)
    → iterative peer lookup, InflightRequestTracker dedup, exponential backoff
```

Message types: ANNOUNCE, REQUEST, CONTENT, ERROR — see `docs/core/data-replication-protocol.md`.

### K-replica vs topic-based

| Strategy | Factory | When |
|----------|---------|------|
| K-replica | `kReplicaContentHashReplication()` | XOR-closest partial storage |
| Topic-based | `topicBasedContentHashReplication()` | Full room replication; `joinTopic()` / `leaveTopic()` |

## Anti-entropy (data convergence)

```
AntiEntropyManager (interval: config.strategies.synchronizer.syncIntervalMs)
  → pick random connected peer
  → AntiEntropyNetworkExchange.syncWithPeer()
      → bidirectional Top-N trie snapshot on /deChat/v1/anti-entropy/1.0.0
      → findMismatches → list missing hashes
  → dataReplication.requestMissingData(hash, peerId) for each
```

`TrieBackedReplicaStore` decorator: `init()` rebuilds trie from `getAllKeys()`; `put()` inserts into trie synchronously. `delete()` throws — append TOMBSTONE instead.

## Config conventions

- Single `DeChatConfig` in `packages/core/src/config/types.ts`
- Defaults: `DECHAT_DEFAULTS` with `isConfigValid()` rules
- Protocol strings namespaced: `/deChat/core/...`, `/deChat/v1/...`

## Adding a new feature (checklist)

1. Define the **interface** (small surface) — use `/codebase-design` vocabulary
2. Implement as a class + `DeChatFactory` export
3. Add optional slot to `DeChatStrategies` and `DeChatComponents.strategies`
4. Wire in `createNode()` — instantiate factory, assign to `components.strategies`
5. If `Startable`, add to lifecycle start/stop sequence
6. Unit test: `packages/core/tests/unit/<area>/<Module>.unit.test.ts`
7. If cross-node: extend interop harness in `packages/core/tests/interop/`
8. Update `CONTEXT.md` or ADR if domain terms or trade-offs change

## Testing patterns

| Type | Pattern | Command |
|------|---------|---------|
| Unit | `*.unit.test.ts` | `yarn core test:file packages/core/tests/unit/...` |
| Integration | `*.int.ts` (worker threads) | `yarn build && yarn test:int` |

**Unit test setup:**

```typescript
// beforeEach: build Partial<DeChatComponents> with mocked libp2p
// instantiate via factory: peerAuthenticator(), dialQueue(), etc.
// afterEach: await module.stop(); vi.clearAllMocks();
```

**Mock only at boundaries:** libp2p handles, `@noble/ed25519`, `level`. Compose real DeChat modules against mocked libp2p.

**Interop harness:**

- `InterOpScenarios.ts` — spawns N workers, runs scenario, terminates
- `workerUitls.ts` → `configureNode()` — production strategy wiring
- Always end with `terminateWorkers(workers)` + `await Promise.all(terminationPromises)`

Narrow interop runs: `--nodes 3 --duration 30` via `parseArg()` in `helper.ts`.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Peer in registry before auth | Route through `PeerAuthenticator` → `pexService.addPeers()` |
| Connection storm | Use `DialQueue`, respect scorer `isDialable()` |
| libp2p starts before trie rebuild | `await replicaStore.init()` in `start()` before libp2p |
| Handler overwrite on same topic/protocol | Use handler registry (`Set<MessageHandler>`) |
| Calling `replicaStore.delete()` | Publish TOMBSTONE event (ADR-0002) |
| Integration test without build | `yarn build` first — tests run compiled `dist/` |
| CI hang after interop test | Missing `terminateWorkers()` / `process.exit(0)` in workers |
| Stale test imports after refactor | Serializers live in `shared/serializers.ts`; K-replica class renamed |

## Verify before done

```bash
yarn test                                          # unit
yarn build && yarn test:int                        # if P2P-touching
yarn lint
```

## Related skills

| Skill | Use for |
|-------|---------|
| `/designing-p2p-systems` | Consistency/replication trade-offs |
| `/codebase-design` | Deep module interface design |
| `/tdd` | Red-green-refactor test workflow |
| `/diagnosing-bugs` | P2P bug feedback loops |
| `/domain-modeling` | CONTEXT.md + ADR updates |
