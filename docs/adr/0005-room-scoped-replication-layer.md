---
status: accepted
---

# Room-scoped replication as a layer on existing strategies

ADR-0001 requires every room member to hold that room’s history. Today `TopicBasedContentReplication` plus the replication protocol announce on **one global topic** and anti-entropy diffs **one global trie**. A peer that joins room A can learn and store room B hashes. We will not rewrite those strategies. We add a **room-scope layer** on top of them.

The layer (`RoomScopedReplication`) wraps an inner `DataReplicationInterface` (topic-based by default). Chat produce/join/leave go through the wrapper. Inner strategies keep persist, REQUEST/CONTENT pull, and K-replica behaviour unchanged.

## How the layer isolates rooms

- **Membership** — `joinRoom` / `leaveRoom` own the set of rooms this node replicates.
- **Room topics** — ANNOUNCE for a room is gossiped on `/deChat/v1/room/<roomId>`, not the global replication topic.
- **Index** — `roomId → hashes` (and reverse) so pulls and serving know which room a hash belongs to. Stored payloads that include a `roomId` field rebuild the index at start.
- **Gating** — `requestMissingData` / delegate `onPeerAnnounced` ignore hashes not mapped to a joined room, so global anti-entropy cannot suck in another room’s payloads.
- **Gap fill** — after join, the layer asks peers for that room’s hash list over a direct protocol (room-index), then pulls via the **existing** replication protocol.

Open rooms (anyone on the same network ID may `joinRoom`) are v1. Capability/invite rooms come later and can reuse this membership set.

## Considered options

| Option | Why rejected |
|--------|----------------|
| **Make `TopicBasedContentReplication` room-aware** | Mixes content-class strategy with room isolation; harder to keep K-replica untouched |
| **Per-room replica store / trie in core strategies** | Replaces rather than layers; large blast radius on anti-entropy |
| **Room logic only in `@dechat/chat`** | Convergence/isolation would leak around any other core caller |
| **Layer on top (wrapper)** | **Chosen.** Inner strategies stay; chat and tests use `produce` / `joinRoom` |

## Consequences

- `onLocalDataProduced` on the wrapper is not the chat send path — use `produce(roomId, data)`.
- Global anti-entropy may still *see* hashes in the shared trie; the wrapper must refuse to fetch unscoped hashes.
- `@dechat/chat` waits for this layer; no single-room shortcut on the global topic.
