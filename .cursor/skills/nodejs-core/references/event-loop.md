---
name: event-loop
description: libuv event loop phases, microtask/nextTick ordering, blocking pitfalls, and measuring loop health.
---

# libuv Event Loop

The event loop runs phases in a fixed order each tick. Most asynchronous timing bugs come from misunderstanding this order.

```
   ┌───────────────────────────┐
┌─>│           timers          │  setTimeout, setInterval (minimum delay)
│  ├───────────────────────────┤
│  │     pending callbacks     │  deferred I/O callbacks (e.g. TCP errors)
│  ├───────────────────────────┤
│  │       idle, prepare       │  internal only
│  ├───────────────────────────┤      ┌───────────────┐
│  │           poll            │<─────┤ incoming I/O  │  ← most network/fs callbacks
│  ├───────────────────────────┤      └───────────────┘
│  │           check           │  setImmediate
│  ├───────────────────────────┤
└──┤      close callbacks      │  socket.on('close', …)
   └───────────────────────────┘
```

## Phases

- **timers** — `setTimeout` / `setInterval`. The delay is a *minimum*, not exact; a blocked loop delays them.
- **pending callbacks** — I/O callbacks deferred from the previous iteration (e.g. some TCP errors like `ECONNREFUSED`).
- **idle, prepare** — internal libuv housekeeping; not reachable from JS.
- **poll** — processes most I/O. When the poll queue empties: jump to **check** if `setImmediate` is pending, else wrap to **timers** if a timer is due, else block waiting for I/O.
- **check** — `setImmediate` callbacks.
- **close callbacks** — `socket.on('close', …)` and similar.

## Microtasks run *between* phases

After each phase (and after each macrotask) Node drains, in order:

1. **`process.nextTick`** queue
2. **Promise microtask** queue (`.then`, `await` continuations)

```ts
setImmediate(() => console.log('immediate'));
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
// sync → nextTick → promise → (timeout|immediate; order non-deterministic in main module)
```

- Inside an **I/O callback**, `setImmediate` always fires before `setTimeout(…, 0)` (you're in poll → check is next).
- **nextTick starvation**: recursive `process.nextTick` starves I/O forever. Use `setImmediate` for recursion that must yield to I/O.

```ts
// BAD — I/O callbacks NEVER run
function loop() { process.nextTick(loop); }
// GOOD — I/O can run between iterations
function loop() { setImmediate(loop); }
```

## Don't block the loop

```ts
// BAD — sync I/O / CPU work freezes ALL connections
const data = fs.readFileSync('big');     // use await fs.promises.readFile
heavyCpu();                              // move to a worker thread (see worker-threads.md)
```

For CPU-bound work that must stay on the main thread, chunk it and yield with `setImmediate` between batches so I/O still gets serviced.

## Measure loop health

```ts
import { monitorEventLoopDelay } from 'node:perf_hooks';
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {
  console.log({ mean: h.mean / 1e6, p99: h.percentile(99) / 1e6 });
  h.reset();
}, 5000);
```

A cheap lag probe:

```ts
let last = Date.now();
setInterval(() => {
  const lag = Date.now() - last - 1000;
  if (lag > 100) console.warn(`Event loop lag: ${lag}ms`);
  last = Date.now();
}, 1000);
```

## DeChat notes

- Anti-entropy reconciliation, SHA-256 hashing, and Merkle-trie walks are CPU work. If p99 loop delay climbs during convergence, batch and yield (`setImmediate`) or offload to a worker thread.
- Schedule response/processing work with `setImmediate` inside I/O callbacks so the poll phase (network I/O) is serviced first.

## References

- Node.js Event Loop guide: https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick
- libuv docs: https://docs.libuv.org/
