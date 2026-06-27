---
name: profiling
description: CPU profiling, flame graphs, optimization/deopt tracing, and timeline events for diagnosing slowdowns.
---

# Profiling

## CPU profiles

```bash
node --prof app.js && node --prof-process isolate-*.log > out.txt   # tick-based CPU profile
node --cpu-prof app.js                                              # .cpuprofile for Chrome DevTools / flame graph
```

Load the `.cpuprofile` in Chrome DevTools (Performance tab) or generate a flame graph to find the hottest frames.

## Optimization / deopt tracing

```bash
node --trace-opt --trace-deopt app.js   # see which functions get optimized vs deoptimized and why
```

Correlate hot frames from the CPU profile with deopt output — a "hot" function that keeps deoptimizing is often the real culprit. Fix by stabilizing types/shapes (see `v8-performance.md`).

## Timeline / async tracing

```bash
node --trace-event-categories v8,node,node.async_hooks app.js   # writes node_trace.*.log (load in chrome://tracing)
```

Use `perf_hooks` for targeted measurements:

```ts
import { performance, PerformanceObserver } from 'node:perf_hooks';
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) console.log(e.name, e.duration);
});
obs.observe({ entryTypes: ['measure'] });

performance.mark('reconcile:start');
await reconcile();
performance.mark('reconcile:end');
performance.measure('reconcile', 'reconcile:start', 'reconcile:end');
```

## Workflow

1. Reproduce the slowdown under a representative load.
2. Capture a CPU profile; identify the hottest frames.
3. Check `--trace-deopt` for deopt-driven slowness in those frames.
4. Apply a fix; re-profile to confirm the hot frame shrank.

## DeChat notes

- Profile during **convergence/propagation** load specifically — that's where SHA-256 hashing, trie walks, and message routing dominate. Use `performance.measure` around reconciliation phases to attribute cost.

## References

- Profiling guide: https://nodejs.org/en/learn/diagnostics/poor-performance
