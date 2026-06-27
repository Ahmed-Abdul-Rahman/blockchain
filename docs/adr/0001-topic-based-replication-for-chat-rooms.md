---
status: accepted
---

# Topic-based full replication for chat rooms

DeChat chat rooms need every member to hold the same message history so anti-entropy can detect and fetch missing hashes. K-replica replication only stores content on the K XOR-closest peers to each hash, so a room member can legitimately lack messages that other members have — making Merkle trie divergence permanent and breaking eventual consistency for chat.

We use **topic-based full replication** (`TopicBasedContentReplication`) for chat: peers that join a room via `joinTopic()` replicate **all** content announced on that topic (`shouldReplicate` always returns true). K-replica replication (`KReplicaContentReplication`) remains available for content that is intentionally sharded by XOR distance (e.g. DHT-style storage), but is not the replication strategy for chat rooms.

## Considered options

| Option | Why rejected for chat |
|--------|----------------------|
| **K-replica only** | Partial storage — room members miss hashes peers farther in XOR space hold; anti-entropy cannot converge a full room history. |
| **K-replica + aggressive push to all topic subscribers** | Duplicates routing logic; still allows gaps if a peer was offline during push. |
| **Topic-based full replication** | **Chosen.** Subscribing to a topic is the replication scope; every member stores every hash in that room. Anti-entropy fills gaps after reconnect. |

## Consequences

- **Storage:** Each room member stores the full room history — acceptable for chat; not suitable for large blob or global DHT data (keep K-replica for that).
- **Bandwidth:** ANNOUNCE still gossips hashes; payloads pulled on demand. Anti-entropy uses Merkle trie snapshots to avoid re-downloading known content.
- **Deletions:** Chat uses append-only CAS with **TOMBSTONE** events — see [ADR-0002](./0002-tombstone-event-sourcing-for-deletions.md).
- **Wiring:** `TopicBasedContentReplication` must be registered in `DeChatStrategies` and started with the node; `joinTopic()` / `leaveTopic()` are the application seam for room membership.
- **K-replica preserved:** `KReplicaContentReplication` is not removed — different replication strategy for different content classes.
