---
name: v8-performance
description: V8 generational GC, hidden classes / inline caches, and TurboFan JIT optimization & deoptimization.
---

# V8: GC, Hidden Classes, JIT

## Generational garbage collection

- **Young generation (new space)** — collected by the fast **Scavenger** (a copying collector). Most objects die young here; allocation is cheap.
- **Old generation** — survivors are promoted; collected by **Mark-Sweep / Mark-Compact** (slower, can introduce pauses).

Implication: short-lived allocations are cheap. Long-lived caches/Maps that only grow create old-space pressure and longer GC pauses. **Bound caches and drop references** when done.

## Hidden classes & inline caches

V8 assigns a hidden class (object "shape") per layout and transitions it as properties are added. Stable shapes let inline caches stay **monomorphic** (fast).

```ts
// GOOD — same property order/shape → shared hidden class → monomorphic
function makePeer(id: string, addr: string) { return { id, addr }; }

// BAD — conditional/late property addition forks hidden classes → polymorphic, slow
const p: any = {};
p.id = id;
if (cond) p.addr = addr;
```

Rules:
- Initialize **all** properties in the **same order** in constructors/factories.
- Avoid `delete` on hot objects — it deopts the shape. Set to `undefined` or use a `Map` for dynamic keys.
- Don't change a property's type across instances (don't store `number` in some, `string` in others).

## JIT (TurboFan) optimization & deoptimization

Hot functions get optimized, then **deoptimized** when assumptions break (type changes, hidden-class churn, `arguments` misuse, `try/catch` in old engines, etc.).

```bash
node --trace-opt --trace-deopt app.js   # which functions deopt and why ("wrong map", "not a Smi")
node --trace-ic app.js                    # inline-cache state transitions
```

Keep hot functions **monomorphic**: stable argument types and stable object shapes. Don't push both `number` and `string` through the same hot path.

## DeChat notes

Hot paths to keep shape/type-stable:
- SHA-256 content hashing
- Merkle prefix-trie traversal in `TrieBackedReplicaStore`
- Per-message routing in propagation layers

Bound any per-peer / per-content `Map` so old-generation pressure doesn't grow without limit (also see `memory-leaks.md`).

## References

- V8 blog: https://v8.dev/blog
- "Understanding hidden classes": https://v8.dev/docs/hidden-classes
