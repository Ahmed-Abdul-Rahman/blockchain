---
name: designing-p2p-systems
description: Design trade-offs for decentralized P2P systems in DeChat. Use when choosing consistency models, replication strategies, convergence mechanisms, or evaluating architectural decisions for libp2p mesh networking — not microservices or blockchain smart contracts.
---

# Designing P2P Systems (DeChat)

Architecture vocabulary and decision frameworks for DeChat's serverless libp2p mesh. Read `CONTEXT.md`, `.cursor/PROJECT.md`, and relevant ADRs in `docs/adr/` before proposing changes.

**This skill is for design reasoning.** For implementation patterns, use `/libp2p-core-patterns`. For code structure, use `/codebase-design`.

## DeChat's position in the distributed systems landscape

DeChat is a **partition-tolerant peer mesh** with **no central coordinator**:

| Property | DeChat choice |
|----------|---------------|
| Topology | Full mesh via libp2p (mDNS + bootstrap + PEX gossip) |
| Identity | Ed25519 keypairs derived from node seed |
| Coordination | None — no leader election, no 2PC, no global ordering |
| Consistency | **Eventual** — convergence via anti-entropy + replication pull |
| Storage model | Content-addressed (SHA-256), append-only CAS |
| Transport | GossipSub (broadcast) + direct libp2p streams |

Under CAP during a network partition: DeChat chooses **AP** (availability + partition tolerance). Peers stay reachable; stale or missing data is reconciled later via anti-entropy.

## Layer model

Do not conflate these layers — each has a single responsibility:

```
Application (planned)     → chat rooms, E2EE, message rendering
Data convergence          → anti-entropy, Merkle prefix trie sync
Data replication          → content-addressed push-pull (ANNOUNCE/REQUEST/CONTENT)
Data propagation          → GossipSub topics + direct stream protocols
Networking                → auth, PEX, dial queue, peer registry, scorer
Replica store             → InMemory / LevelDB (+ TrieBacked decorator)
```

From `docs/core/design-principles.md`:

- **Replication** decides what to store
- **Convergence** ensures eventual correctness
- **ReplicaStore** decides where and how data lives

## Consistency model decisions

| Use case | Model | DeChat mechanism |
|----------|-------|------------------|
| Chat room history | Eventual (full convergence) | Topic-based replication + anti-entropy |
| DHT-style sharded content | Eventual (partial) | K-replica XOR placement |
| Peer registry | Eventual | PEX gossip + auth-gated upsert |
| Auth handshake | Strong (per connection) | Ed25519 signature over nonce — must succeed before trust |
| Message ordering (future) | Causal (planned) | Not implemented — do not assume global order today |

**Default to eventual consistency.** Strengthen only at clear seams (auth handshake is the main exception).

## Replication strategy decision tree

```
Is every member of a group required to hold the same content?
├─ YES (chat room, shared history)
│  └─ Topic-based full replication (ADR-0001)
│     Peers join via joinTopic(); shouldReplicate() always true
│     Anti-entropy fills gaps after offline periods
│
└─ NO (content sharded by hash proximity)
   └─ K-replica replication
      Store only if among K XOR-closest peers to content hash
      Use for DHT-style storage, not chat rooms
```

Never mix strategies for the same content class without an explicit ADR.

## Convergence (anti-entropy)

When peers may have divergent hash sets (offline peer, missed ANNOUNCE, churn):

1. **Prefix trie** — Merkle tree over content hashes (16-branch hex routing)
2. **Top-N snapshot exchange** — peers compare trie roots/branches without sending payloads
3. **Missing hash list** — `findMismatches()` yields exact hashes to fetch
4. **Pull** — `dataReplication.requestMissingData(hash, peerId)`

Anti-entropy is **proactive** (scheduled). Replication ANNOUNCE/REQUEST is **reactive** (event-driven). Both are needed.

## Deletions in an append-only CAS

Never delete stored hashes in place — it breaks trie convergence. See ADR-0002.

- Publish a **TOMBSTONE** event (new content-addressed record)
- Application layer projects "visible messages" by replaying events and filtering tombstoned hashes
- `replicaStore.delete()` throws by design

## Propagation vs replication

| Scenario | Broadcast (GossipSub) | Direct streams |
|----------|----------------------|----------------|
| New local data | ANNOUNCE | Optional push to K peers |
| Anti-entropy sync | No | Yes (trie RPC) |
| Large payload transfer | No | Yes (REQUEST/CONTENT) |
| High churn network | Limited | Preferred |
| Auth handshake | No | Yes |

Full payloads are never gossip-broadcast — only hashes are announced.

## Design checklist

Before approving a P2P design change, verify:

- [ ] No central coordinator introduced (leader, orchestrator, global lock)
- [ ] Auth precedes registry membership (verified peer only)
- [ ] Dialing goes through `DialQueue` + scorer (no connection storms)
- [ ] Content remains content-addressed (hash identifies immutable payload)
- [ ] Deletions use TOMBSTONE events, not `delete()`
- [ ] Convergence path exists for offline/reconnect scenarios
- [ ] Strategy plugs in via `DeChatStrategies`, not ad-hoc `node.ts` edits
- [ ] Decision recorded in ADR if hard to reverse (see `/domain-modeling`)

## Anti-patterns for DeChat

| Anti-pattern | Why it fails here | Do instead |
|--------------|-------------------|------------|
| Leader-follower replication | Single point of failure; incompatible with mesh | Topic-based or K-replica |
| Two-phase commit / distributed transactions | Blocks on partition; needs coordinator | Eventual consistency + idempotent ops |
| In-place record deletion | Breaks Merkle trie; divergent snapshots | TOMBSTONE append event |
| Gossip full payloads | Network amplification storms | ANNOUNCE hash only; pull content |
| Ad-hoc `libp2p.dial()` loops | Connection storms | `DialQueue.enqueue()` |
| Peers in registry before auth | Trust boundary violation | `PeerAuthenticator` first |
| Strong consistency everywhere | Latency + availability cost | Eventual + anti-entropy |
| Microservice saga pattern | Wrong architecture class | P2P replication + convergence |
| Smart contract for messaging | Wrong layer (see `@dechat/blockchain` legacy) | libp2p replication stack |

## When to write an ADR

Use `/domain-modeling` to record decisions when all three are true:

1. Hard to reverse later
2. Surprising without context
3. Result of a real trade-off between alternatives

Existing ADRs:

- [ADR-0001](docs/adr/0001-topic-based-replication-for-chat-rooms.md) — topic replication for chat
- [ADR-0002](docs/adr/0002-tombstone-event-sourcing-for-deletions.md) — append-only + TOMBSTONE
- [ADR-0003](docs/adr/0003-adaptive-anti-entropy-scheduling.md) — adaptive anti-entropy scheduling (proposed)

## Further reading

| Resource | Path |
|----------|------|
| Domain glossary | `CONTEXT.md` |
| Replication protocol spec | `docs/core/data-replication-protocol.md` |
| Design principles | `docs/core/design-principles.md` |
| Project config | `.cursor/PROJECT.md` |
| Sprint context | `NEXT.md` |
