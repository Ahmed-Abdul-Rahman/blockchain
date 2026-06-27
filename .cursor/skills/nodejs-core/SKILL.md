---
name: nodejs-core
description: Node.js runtime internals — libuv event loop phases, microtask/nextTick ordering, thread pool tuning, worker threads (MessageChannel/SharedArrayBuffer/Atomics/transfer), streams & backpressure, V8 GC/hidden-classes/JIT deopt, memory leak detection, profiling, and native addons. Use when diagnosing event-loop lag, worker-thread leaks (DeChat interop tests), backpressure, memory growth, deoptimization, or any behavior below the JS layer.
metadata:
  tags: nodejs, libuv, v8, worker-threads, streams, performance, debugging, internals
---

# Node.js Core Internals (DeChat)

Runtime-internals knowledge for building and debugging DeChat's libp2p engine and its worker-thread interop harness. Curated from [mcollina/skills · nodejs-core](https://www.skills.sh/mcollina/skills/nodejs-core) and the full rule set in [github.com/mcollina/skills](https://github.com/mcollina/skills/tree/main/skills/nodejs-core).

Scope note: the upstream skill also covers building Node.js core itself (node-gyp, `./configure`, C++ addons, primordials). DeChat *consumes* Node.js rather than patching it, so this skill foregrounds the **application-relevant** internals and keeps native/build material as a brief reference.

## How to use

Read the relevant rule file for detail and runnable examples:

### Async runtime
- [references/event-loop.md](references/event-loop.md) — phases, microtask/`nextTick` ordering, blocking pitfalls, measuring loop health
- [references/thread-pool.md](references/thread-pool.md) — what uses the pool, `UV_THREADPOOL_SIZE` tuning
- [references/worker-threads.md](references/worker-threads.md) — **lifecycle + MANDATORY teardown (interop tests)**, MessageChannel, SharedArrayBuffer, Atomics

### Data flow & performance
- [references/streams-backpressure.md](references/streams-backpressure.md) — `highWaterMark`, `'drain'`, `pipeline()`, object mode
- [references/v8-performance.md](references/v8-performance.md) — generational GC, hidden classes, JIT optimization/deopt

### Diagnostics
- [references/memory-leaks.md](references/memory-leaks.md) — heap snapshots, common leak sources in long-running nodes
- [references/profiling.md](references/profiling.md) — CPU profiles, flame graphs, `--trace-opt`/`--trace-deopt`, `perf_hooks`

### Native (reference)
- [references/native-addons.md](references/native-addons.md) — N-API/node-addon-api, handle management, native debugging (rarely needed)

## Core rules

1. **Never block the event loop.** No sync fs/CPU on the main thread — `await` async APIs or offload to a worker. See `references/event-loop.md`.
2. **Every `Worker` must be `await terminate()`d** (and timers cleared, sockets closed) in test teardown, or **CI hangs**. See `references/worker-threads.md`. (`.cursorrules`.)
3. **Honor backpressure** — never write to a stream ignoring `write() === false`; prefer `pipeline()`. See `references/streams-backpressure.md`.
4. **Keep hot functions monomorphic** — stable arg types and object shapes; bound long-lived caches. See `references/v8-performance.md`.

## DeChat relevance map

| Internal | Why it matters for DeChat |
|----------|---------------------------|
| Event loop phases / `nextTick` | Timer vs I/O ordering in propagation; avoid starving I/O during convergence |
| Thread pool / `UV_THREADPOOL_SIZE` | Crypto + LevelDB (fs) throughput under load |
| Worker threads + `terminate()` | Interop test harness — **mandatory teardown or CI hangs** |
| SharedArrayBuffer / Atomics | Zero-copy shared state between test nodes if needed |
| Streams & backpressure | libp2p stream propagation without unbounded buffering |
| GC / hidden classes / deopt | Hot paths: SHA-256 hashing, trie walks, message routing |
| Memory leak detection | Per-peer listeners/timers/Maps in long-running nodes |
| Profiling | Diagnose convergence/propagation slowdowns |

## Diagnostic decision trees

**Event-loop lag / latency spikes** → measure with `monitorEventLoopDelay`. CPU-bound? offload to a worker / batch with `setImmediate`. Blocked on fs/crypto? raise `UV_THREADPOOL_SIZE`. Microtask flood? check for `nextTick`/Promise recursion. (`references/event-loop.md`, `references/thread-pool.md`)

**CI hangs after tests** → a worker/socket/timer wasn't cleaned up. Ensure every `Worker` is `await terminate()`d, every interval `clearInterval`ed, every server `close()`d. (`references/worker-threads.md`)

**Memory grows over time** → heap snapshot diff; look for retained listeners, unbounded Maps keyed by peer/content id, uncleared timers. (`references/memory-leaks.md`)

**Function unexpectedly slow** → `--trace-opt --trace-deopt`; stabilize argument types and object shapes to keep it monomorphic. (`references/v8-performance.md`, `references/profiling.md`)

## Related skills

| Skill | Use for |
|-------|---------|
| `/typescript` | Type-level + code conventions above the runtime |
| `/diagnosing-bugs` | Structured loop for the hard cases this skill diagnoses |
| `/libp2p-core-patterns` | How DeChat wires streams/workers around libp2p |
| `/tdd` | Worker-thread integration test conventions |
