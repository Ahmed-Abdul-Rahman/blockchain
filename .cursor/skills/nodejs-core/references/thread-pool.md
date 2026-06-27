---
name: thread-pool
description: libuv thread pool sizing, which operations use it, and UV_THREADPOOL_SIZE tuning.
---

# libuv Thread Pool

A fixed pool of worker threads (default **4**) backs the operations that have no async OS primitive:

- `fs.*` (file I/O)
- `dns.lookup` (note: `dns.resolve*` does **not** use the pool — it's network I/O)
- `crypto` CPU-bound calls: `pbkdf2`, `scrypt`, `randomBytes`, `randomFill`
- `zlib` (compression)

**Network sockets do NOT use the pool** — they're event-driven via the poll phase. So the pool only matters for fs/crypto/zlib throughput.

## Sizing

The pool size is fixed **at process startup** and cannot be changed afterwards.

```bash
UV_THREADPOOL_SIZE=16 node app.js     # set BEFORE start; max 1024
```

```ts
process.env.UV_THREADPOOL_SIZE = 16;  // TOO LATE — pool already sized
```

Set it via the shell, `package.json` script, or service manager:

```jsonc
// package.json
{ "scripts": { "start": "UV_THREADPOOL_SIZE=16 node app.js" } }
```

## When to tune

- **I/O-heavy or crypto-heavy** workloads benefit from a larger pool; size relative to cores and concurrency.
- **Symptom of saturation**: rising I/O / event-loop latency p99 while CPU is *not* maxed → the pool is the bottleneck → increase `UV_THREADPOOL_SIZE`.
- Don't oversize blindly; too many threads add context-switching overhead.

## DeChat notes

- LevelDB-backed replica stores and `@noble`/crypto operations can contend for the 4 default threads under load. If convergence or persistence latency spikes without CPU saturation, raise `UV_THREADPOOL_SIZE` for the node process.
- In worker-thread interop tests, each worker has its **own** pool — total pool threads = `UV_THREADPOOL_SIZE × workers`. Keep that in mind when sizing on constrained CI runners.

## References

- libuv thread pool: https://docs.libuv.org/en/v1.x/threadpool.html
