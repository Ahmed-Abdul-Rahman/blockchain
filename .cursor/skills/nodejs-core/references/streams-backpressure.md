---
name: streams-backpressure
description: Node.js streams, highWaterMark/backpressure, pipeline() for error-safe composition, and object-mode.
---

# Streams & Backpressure

libp2p streams and DeChat propagation are stream-based. Honoring backpressure prevents unbounded buffering and OOM.

## Backpressure basics

- `writable.write(chunk)` returns `false` when the internal buffer exceeds `highWaterMark`. When it returns `false`, **stop writing and wait for the `'drain'` event** before resuming.
- Ignoring this (writing in a tight loop regardless of the return value) buffers unboundedly → RSS growth → OOM.

```ts
function writeAll(w: NodeJS.WritableStream, chunks: Buffer[]) {
  let i = 0;
  (function next() {
    while (i < chunks.length) {
      const ok = w.write(chunks[i++]);
      if (!ok) { w.once('drain', next); return; }  // respect backpressure
    }
    w.end();
  })();
}
```

## Prefer `pipeline()`

`pipeline()` wires backpressure **and** propagates errors **and** cleans up every stream on completion or failure — avoiding the leaks you get from manual `.pipe()` chains when one stream errors.

```ts
import { pipeline } from 'node:stream/promises';
await pipeline(source, transform, sink);  // backpressure + error handling + cleanup
```

Manual `.pipe()` does **not** forward errors or destroy upstream streams on failure — avoid it for anything non-trivial.

## Object mode

```ts
new Readable({ objectMode: true, read() { /* push objects, not bytes */ } });
```

In object mode, `highWaterMark` counts **objects**, not bytes. Useful for message/event streams.

## Common pitfalls

- Not handling `'error'` on every stream in a chain → unhandled exception / partial cleanup. `pipeline` centralizes this.
- Async transforms that don't apply backpressure to their source → memory blowup.
- Forgetting to `destroy()` / `end()` streams on shutdown → leaked handles keep the loop alive (see `/nodejs-core` worker-threads teardown).

## DeChat notes

- For libp2p stream propagation, drive writes through backpressure-aware composition (`pipeline` or honoring `write()`/`'drain'`), so a slow peer can't make a fast sender buffer the whole topic in memory.

## References

- Streams: https://nodejs.org/api/stream.html
- Backpressuring in Streams: https://nodejs.org/en/learn/modules/backpressuring-in-streams
