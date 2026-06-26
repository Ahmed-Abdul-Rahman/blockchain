---
name: worker-threads
description: Worker thread lifecycle, MessageChannel/MessagePort, SharedArrayBuffer + Atomics, structured clone, and MANDATORY teardown for DeChat interop tests.
---

# Worker Threads

DeChat's integration tests (`*.int.ts`) spin up worker-thread P2P nodes. Get the lifecycle and teardown exactly right or **CI hangs**.

## Spawn, communicate, terminate

```ts
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./node-worker.ts', import.meta.url), {
  workerData: { peerSeed, bootstrap },   // structured-cloned into the worker
});

worker.on('message', onMessage);
worker.on('error', onError);             // ALWAYS handle — unhandled error crashes the process
worker.on('exit', (code) => { /* code !== 0 → failure */ });

// Teardown (MANDATORY in tests):
await worker.terminate();                // await it; frees the thread + native handles
```

- `workerData` and `postMessage` values are **structured-cloned** — use plain-data objects. Functions, class instances, and closures do **not** survive the boundary.
- Always attach `error` **and** `exit` handlers. A worker that throws with no `error` listener takes the whole process down.

## MANDATORY teardown (or CI hangs)

`.cursorrules`: integration tests MUST clean up all worker threads before finishing, or CI hangs. Track workers and tear them all down:

```ts
const workers: Worker[] = [];
// ... spawn and push ...
afterEach(async () => {
  await Promise.all(workers.map((w) => w.terminate()));
  workers.length = 0;
});
```

Also clear any intervals/timers and close any servers/sockets the worker or harness created — a single leaked handle keeps the loop alive.

## MessageChannel / MessagePort

```ts
import { MessageChannel } from 'node:worker_threads';
const { port1, port2 } = new MessageChannel();
worker.postMessage({ port: port2 }, [port2]); // transfer port2 via the transferList
port1.on('message', handle);
port1.start?.();                                // begin receiving (if not auto-started)
```

- Objects listed in the **transferList** are *moved*, not copied: `MessagePort`, `ArrayBuffer`, etc. A transferred `ArrayBuffer` becomes unusable (detached) on the sender side.
- Close ports (`port.close()`) you no longer need so they don't keep the loop alive.

## SharedArrayBuffer + Atomics (zero-copy shared state)

```ts
const shared = new Int32Array(new SharedArrayBuffer(4));
// pass via workerData or postMessage — shared by REFERENCE, no clone

Atomics.add(shared, 0, 1);                 // atomic increment
Atomics.compareExchange(shared, 0, 0, 1);  // CAS — build spinlocks
Atomics.load(shared, 0);                    // atomic read
Atomics.store(shared, 0, 42);               // atomic write
Atomics.wait(shared, 0, 0);                 // block until value changes (workers ONLY)
Atomics.notify(shared, 0, 1);              // wake N waiters
```

- `SharedArrayBuffer` is shared by reference — ideal for high-throughput shared counters/state between threads.
- Use `Atomics` for **all** access to shared memory to avoid data races.
- `Atomics.wait` cannot be used on the main thread (it would block the event loop); use it only inside workers.

## DeChat notes

- Model anything crossing the worker boundary as a **plain-data object** (see `/typescript` plain-data types). Don't try to pass libp2p instances or class objects.
- Prefer one helper that spawns, registers `error`/`exit`, and pushes to a tracked array, paired with one teardown helper — makes "clean up every worker" the default path.

## References

- worker_threads: https://nodejs.org/api/worker_threads.html
