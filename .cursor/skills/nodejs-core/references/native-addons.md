---
name: native-addons
description: Brief reference for N-API / node-addon-api, handle management, external memory, and native debugging. Rarely needed in DeChat.
---

# Native Addons (reference)

DeChat rarely needs native addons — `@noble/*` and built-in `crypto` cover our needs in pure JS. Keep this as a reference for the uncommon case (e.g. wrapping a C library).

## Choosing an API

- Prefer **N-API** (C) or **node-addon-api** (C++ wrapper over N-API) over raw V8 / NAN. N-API is **ABI-stable** — a single `.node` binary works across Node major versions without recompilation.
- Use **async workers** (`Napi::AsyncWorker` / `napi_create_async_work`) for CPU-bound native work so you don't block the event loop; results land back on the loop via a callback.

## Handle & memory management

- Manage V8 handles with `HandleScope` / `EscapableHandleScope`. Mismatched scopes are a classic **segfault** cause — return values that must outlive the scope need `EscapableHandleScope::Escape`.
- Tell GC about memory you allocate outside V8 so it can schedule collection: `Napi::MemoryManagement::AdjustExternalMemory(...)` (or `napi_adjust_external_memory`). Otherwise large native buffers create invisible pressure and OOM.
- Free native resources in a finalizer tied to the JS wrapper object's lifetime; don't rely on manual `delete` from JS.

## Build

- Native addons build via **node-gyp** + `binding.gyp` (gyp → ninja/make). Common failures:
  - Missing header → check `include_dirs` and that Node headers are installed.
  - Linker error → check `libraries` / `link_settings`; confirm ABI compatibility.
  - Platform-specific → Windows/macOS/Linux differ in toolchain and flags.
- **Rebuild after any source change** before testing — a stale `.node` gives meaningless results.

## Debugging native crashes

```bash
gdb --args node ./script.js      # or: lldb -- node ./script.js
run
bt        # backtrace on crash
```

Decision tree for a segfault in an addon:
1. Reproducible? Capture `bt`.
2. `bt` points to a V8 handle issue → audit `HandleScope` / `EscapableHandleScope` usage.
3. `bt` points to a libuv callback → check async handle lifetime and `uv_close()` sequencing.
4. No clear C++ frame → check JS-side type mismatches passed into the binding.

Confirm no native leaks remain with `valgrind --leak-check=full node addon_test.js`.

## References

- N-API: https://nodejs.org/api/n-api.html
- node-addon-api: https://github.com/nodejs/node-addon-api
