---
status: accepted
---

# Append-only storage with TOMBSTONE events for deletions

DeChat's replica store is **content-addressed** (SHA-256 hashes) and backed by a **Merkle prefix trie** for anti-entropy sync. Deleting a stored hash in place would remove it from the trie, change the root snapshot peers exchange, and break deterministic convergence — two peers that "deleted" the same message at different times would diverge permanently.

We treat the replica store as **append-only**: `delete()` is forbidden on `InMemoryReplicaStore`, `LevelDbReplicaStore`, and `TrieBackedReplicaStore` (they throw *"DeChat is append-only. Publish a TOMBSTONE event instead."*). Message removal is modeled as a new **TOMBSTONE** event — a content-addressed record that references the hash being tombstoned. The original payload remains in storage; the application layer projects "current room state" by replaying events and treating tombstoned hashes as absent.

## Considered options

| Option | Why rejected |
|--------|--------------|
| **In-place `delete()`** | Removes hash from trie; anti-entropy snapshots diverge; offline peers cannot reconcile deletions reliably. |
| **Mutable records (overwrite hash)** | Breaks content-addressing — hash no longer identifies immutable content. |
| **TOMBSTONE append event** | **Chosen.** New hash, new trie insert, replicated like any message. Deletion is eventual-consistency friendly. |
| **CRDT delete-wins set** | Heavier application protocol; deferred until chat layer needs richer merge semantics. |

## Consequences

- **Storage grows:** Tombstoned payloads remain on disk. Compaction/garbage-collection is a future concern (out of scope for now).
- **Read path:** Application code must filter tombstoned hashes when rendering a room — not handled in the replication layer yet.
- **Replication:** TOMBSTONE events flow through the same path as messages (`onLocalDataProduced` → hash → store → ANNOUNCE) per [ADR-0001](./0001-topic-based-replication-for-chat-rooms.md).
- **Trie:** Every tombstone is a new insert; trie only grows, never shrinks — consistent with anti-entropy design.
- **Enforcement:** All replica store implementations reject `delete()` at runtime; do not bypass via `clear()` in production paths.

## Related

- [ADR-0001: Topic-based replication for chat rooms](./0001-topic-based-replication-for-chat-rooms.md)
