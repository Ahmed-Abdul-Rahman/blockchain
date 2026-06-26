---
name: memory-leaks
description: Detecting and fixing JS/native memory leaks with heap snapshots; common leak sources in long-running P2P nodes.
---

# Memory Leak Detection

## Tools

```bash
node --inspect app.js     # chrome://inspect → take TWO heap snapshots, compare retained size growth
node --expose-gc app.js   # call global.gc() between snapshots to discount uncollected garbage
```

Workflow: take a baseline snapshot, exercise the workload, force GC, take a second snapshot, and diff. Growing **retained size** on objects that should be transient = a leak. For native leaks (addons/buffers), use `valgrind --leak-check=full node …`.

## Common leak sources in P2P / long-running nodes

- **Event listeners never removed** — `emitter.on(...)` per peer/connection without a matching `off`. Use `once` where possible, or remove listeners on disconnect.
- **Timers/intervals not cleared** — peer heartbeats, anti-entropy intervals, retry timers. `clearInterval`/`clearTimeout` on shutdown.
- **Unbounded Maps/Sets** — keyed by peer id or content hash that never evict departed peers or tombstoned content. Add eviction / TTL / size bounds.
- **Closures capturing large objects** — a long-lived callback retaining a big buffer or whole message.
- **Unclosed workers/sockets/streams** — also surface as leaked native handles that keep the loop alive.

## Pattern: scope listeners and timers to lifetime

```ts
function attachPeer(peer: Peer) {
  const onMsg = (m: Message) => handle(m);
  peer.on('message', onMsg);
  const hb = setInterval(() => ping(peer), 15_000);

  return function cleanup() {           // call on peer disconnect
    peer.off('message', onMsg);
    clearInterval(hb);
  };
}
```

## DeChat notes

- Audit `PeerRegistry` and any per-peer/per-content `Map` for eviction on peer departure and on TOMBSTONE events.
- In interop tests, a "leak" is usually a missing `terminate()`/`clearInterval`/`close()` — see `worker-threads.md`.

## References

- Heap snapshots: https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot
