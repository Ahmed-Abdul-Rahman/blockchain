# Task: Unified Wire Serialization (Phase 1)

**Backlog ref:** BACKLOG.md Task 1.1  
**Status:** Completed (2026-06-28, PR #35)  
**Goal:** Replace ad-hoc JSON wire encoding across `@dechat/core` with a single DI-injected wire codec (CBOR default), while keeping `canonicalSerialize` unchanged for content hashing.

### Approved decisions (2026-06-28)

1. CBOR as default wire format (protobuf deferred to Phase 2)
2. 1-byte format prefix on every wire frame
3. `ReplicationContent.replicationContent` → `Uint8Array`
4. Remove `processDataFromStream` from networking utils
5. `JsonWireSerializer` remains available as plug-and-play alternative

### Pre-production note

No nodes are deployed in production. **No backward-compatibility shims required** — clean cutover to the new wire format. Both codecs remain available; switching is a single config change (`serialization.wireFormat`) applied once in `createNode` and propagated package-wide via `components.serializer`.

---

## Problem Summary

Serialization is split across three inconsistent patterns today:

| Pattern | Locations | Issue |
|---|---|---|
| Raw JSON | `GossipSubPropagation`, `streamUtils`, `PeerExchangeService`, `networking/utils` | Bypasses DI; blocks event loop; no binary field support |
| `getGenericDataSerailizer()` direct call | `KReplicaContentReplication`, `TopicBasedContentReplication` | Ignores `components.serializer` injected in `createNode` |
| `components.serializer` via DI | `InMemoryReplicaStore`, `LevelDbReplicaStore`, `TrieBackedReplicaStore` | Correct pattern, but implementation is broken (see below) |

**Existing bug:** `getGenericDataSerailizer()` serializes with `canonicalSerialize` but deserializes with `JSON.parse`. Works accidentally for simple objects but is semantically wrong and will break once wire format diverges from canonical form.

---

## Architecture Decision

### Two layers — never merge

```
┌──────────────────────────────────────────────────────────────┐
│  Identity layer (UNCHANGED in Phase 1)                       │
│  canonicalSerialize → Sha256ContentHashStrategy              │
│  Purpose: deterministic content hash for replication identity│
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Wire layer (NEW — unified via DI)                           │
│  WireCodec / DataSerializer                                  │
│  ├── CborWireSerializer (default)                            │
│  └── JsonWireSerializer (configurable alternative)           │
│  Purpose: network propagation, streams, replica store bytes  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Framing layer (transport-specific, no codec choice)           │
│  FramedStreamCodec — length-prefix via it-length-prefixed    │
│  Used by: libp2p streams only (not GossipSub raw publish)    │
└──────────────────────────────────────────────────────────────┘
```

### Wire format envelope

Every `WireCodec.serialize()` output is prefixed with a 1-byte format ID:

| Byte | Format |
|---|---|
| `0x00` | JSON |
| `0x01` | CBOR (default) |

`deserialize()` validates the format byte matches the configured codec. No legacy/migration fallback (pre-production).

### Config-driven codec selection

**File:** `packages/core/src/config/types.ts`

```typescript
serialization: {
  /** Wire encoding used package-wide via components.serializer */
  wireFormat: 'cbor' | 'json';
};
```

**Default:** `'cbor'` in `DECHAT_DEFAULTS`.

**Factory:** `createWireSerializer(config.serialization.wireFormat)` called once in `createNode`. All propagation, replication, streams, and stores use `components.serializer` — no per-module codec choice.

### Transport patterns (same codec, different framing)

| Transport | Encode path | Decode path |
|---|---|---|
| GossipSub pub/sub | `serializer.serialize(msg)` → `pubsub.publish(topic, bytes)` | `serializer.deserialize(data)` |
| libp2p streams | `lp.encode([serializer.serialize(msg)])` | `lp.decode` → `serializer.deserialize(frame)` |
| Replica store | `serializer.serialize(data)` → LevelDB/memory | `serializer.deserialize(rawBytes)` |

Remove the intermediate UTF-8 string round-trip in `streamUtils` (`JSON.stringify` → `uint8ArrayFromString`).

---

## Dependency Addition

**File:** `packages/core/package.json`

```json
"cbor-x": "^1.6.0"
```

Run `yarn install` from monorepo root.

CBOR config for DeChat:
- `useRecords: false` — generic object graphs, no class schema required
- `structuredClone: true` — proper `Uint8Array` round-trip for signatures and replica blobs
- `moreTypes: true` — `Date` support if needed

---

## New Files

### 1. `packages/core/src/shared/serialization/types.ts`

Define and export:

```typescript
/** Wire format identifiers — first byte of every serialized frame */
export const WIRE_FORMAT = {
  JSON: 0x00,
  CBOR: 0x01,
} as const;

export type WireFormatId = (typeof WIRE_FORMAT)[keyof typeof WIRE_FORMAT];

/** Wire encoding for network + storage. Distinct from canonical hashing. */
export interface WireCodec {
  readonly formatId: WireFormatId;
  serialize<T>(data: T): Uint8Array;
  deserialize<T>(bytes: Uint8Array): T;
}
```

Keep existing `DataSerializer` in `shared/types.ts` as a type alias for backward compatibility:

```typescript
export type DataSerializer = WireCodec;
```

Update `DeChatComponents.serializer` type to `WireCodec` (same shape, adds `formatId`).

---

### 2. `packages/core/src/shared/serialization/canonicalSerializer.ts`

**Move** `canonicalSerialize` from `shared/serializers.ts` into this file unchanged.

- No logic changes
- Existing tests in `canonicalSerializer.unit.test.ts` update import path only

---

### 3. `packages/core/src/shared/serialization/jsonWireSerializer.ts`

Extract JSON wire encoding (NOT canonical form):

```typescript
export const createJsonWireSerializer = (): WireCodec => ({
  formatId: WIRE_FORMAT.JSON,
  serialize: (data) => { /* 0x00 prefix + UTF-8(JSON.stringify(data)) */ },
  deserialize: (bytes) => { /* strip prefix, JSON.parse */ },
});
```

Preserve existing buffer-like input normalization from current `deserialize` (Uint8Array, Buffer JSON rep from worker IPC, ArrayBuffer, number[]) — move into a shared `normalizeToUint8Array(bytes: unknown): Uint8Array` helper in `serialization/utils.ts`.

---

### 4. `packages/core/src/shared/serialization/cborWireSerializer.ts`

```typescript
export const createCborWireSerializer = (): WireCodec => ({
  formatId: WIRE_FORMAT.CBOR,
  serialize: (data) => { /* 0x01 prefix + cbor-x encode */ },
  deserialize: (bytes) => { /* read formatId, cbor-x decode body */ },
});
```

Use a shared `decodeWireEnvelope(bytes)` helper that validates format ID and returns `{ formatId, payload }`.

---

### 5. `packages/core/src/shared/serialization/dispatchingWireSerializer.ts`

Optional composite for migration read path:

```typescript
/** Tries format byte dispatch; falls back to JSON body if no prefix (v0 compat) */
export const createDispatchingWireSerializer = (primary: WireCodec): WireCodec => ...
```

Used internally by `createCborWireSerializer` deserialize, or as explicit migration helper. Decision: build dispatch into each codec's `deserialize` via shared `decodeWireEnvelope` rather than a wrapper — simpler.

---

### 6. `packages/core/src/shared/serialization/utils.ts`

Shared helpers:
- `normalizeToUint8Array(input: unknown): Uint8Array` — worker IPC buffer normalization
- `prependFormatId(formatId: WireFormatId, payload: Uint8Array): Uint8Array`
- `stripFormatId(bytes: Uint8Array): { formatId: WireFormatId; payload: Uint8Array }`

---

### 7. `packages/core/src/shared/serialization/framedStreamCodec.ts`

Factory bound to a `WireCodec`:

```typescript
export interface FramedStreamCodec {
  writeToStream(stream: Stream, message: unknown): Promise<void>;
  readFromStream(stream: Stream, maxDataLength?: number): Promise<unknown>;
  readMessagesFromStream(stream: Stream, onMessage: (msg: unknown) => void, maxDataLength?: number): Promise<void>;
  setupRPCStream<T>(stream: Stream, handler: ..., requestTimeoutMs?: number): { sendRequest: ... };
}

export const createFramedStreamCodec = (serializer: WireCodec): FramedStreamCodec => ({ ... });
```

Implementation:
- **Write:** `serializer.serialize(msg)` → single-element array → `lp.encode` → `stream.sink`
- **Read:** `lp.decode` → `serializer.deserialize(buffer)` (no string intermediate)
- **RPC:** same codec for request/response `BaseMessage<T>` envelopes

---

### 8. `packages/core/src/shared/serialization/index.ts`

Barrel exports:
- `WireCodec`, `WIRE_FORMAT`, `DataSerializer` (re-export)
- `createCborWireSerializer`, `createJsonWireSerializer`
- `createFramedStreamCodec`, `FramedStreamCodec`
- `canonicalSerialize`

---

### 9. `packages/core/tests/unit/shared/cborWireSerializer.unit.test.ts`

Test cases:
- Round-trip primitives, nested objects, arrays
- `Uint8Array` field round-trip (PropagatedMessage with signature)
- Format byte prefix present and correct
- `normalizeToUint8Array` for worker Buffer JSON representation
- Invalid format byte throws explicit error
- Oversized input rejected if we add max-bytes guard

---

### 10. `packages/core/tests/unit/shared/jsonWireSerializer.unit.test.ts`

Test cases:
- Round-trip equivalence with plain JSON
- Format byte prefix
- Legacy body without prefix (optional v0 compat test)

---

### 11. `packages/core/tests/unit/shared/framedStreamCodec.unit.test.ts`

Test cases:
- Write/read round-trip through mock stream
- `readMessagesFromStream` delivers multiple messages
- `setupRPCStream` request/response correlation
- Respects `maxDataLength`

---

## Modified Files

### A. Delete / deprecate: `packages/core/src/shared/serializers.ts`

Replace with re-export shim for backward compat (one release cycle):

```typescript
/** @deprecated Use createCborWireSerializer from './serialization' */
export { createJsonWireSerializer as getGenericDataSerailizer } from './serialization/jsonWireSerializer';
export { canonicalSerialize } from './serialization/canonicalSerializer';
```

Or rename export: `getGenericDataSerailizer` → deprecated alias to `createJsonWireSerializer`.

---

### B. `packages/core/src/shared/types.ts`

- Add `export type { WireCodec as DataSerializer } from './serialization/types'` OR keep interface and extend with optional `formatId`
- `BaseMessage<T>` — no change

---

### C. `packages/core/src/node.ts`

```diff
- import { getGenericDataSerailizer } from './shared/serializers';
+ import { createCborWireSerializer } from './shared/serialization';

- components.serializer = getGenericDataSerailizer();
+ components.serializer = createCborWireSerializer();
```

Optional: allow override via `createNode` parameter:

```typescript
export const createNode = async (
  infoHash: string,
  nodeSeed: string,
  userOpts?: PartialDeep<DeChatConfig>,
  strategies?: DeChatStrategies,
  serializer?: WireCodec,  // optional override for tests
)
```

---

### D. `packages/core/src/types.ts`

No structural change — `serializer: DataSerializer` already on `DeChatComponents`. Document in JSDoc that all wire encoding must use this field.

---

### E. `packages/core/src/data-propagation/broadcast/GossipSubPropagation.ts`

**Changes:**
1. Add `private readonly serializer: WireCodec` from `components.serializer`
2. **`publish`:** replace `uint8ArrayFromString(JSON.stringify(message))` with `this.serializer.serialize(message)`
3. **`gossipListener`:** replace `JSON.parse(uint8ArrayToString(data))` with `this.serializer.deserialize(data)`
4. Remove unused `uint8ArrayFromString` / `uint8ArrayToString` imports if no longer needed
5. Size check stays before decode: `data.length > maxMsgBytes` (already present)

---

### F. `packages/core/src/data-propagation/direct/DirectStreamPropagation.ts`

**Changes:**
1. Add `private readonly framedStream: FramedStreamCodec` created in constructor:
   ```typescript
   this.framedStream = createFramedStreamCodec(components.serializer);
   ```
2. Replace `writeToStream` → `this.framedStream.writeToStream`
3. Replace `readMessagesFromStream` → `this.framedStream.readMessagesFromStream`
4. Remove direct `streamUtils` import

---

### G. `packages/core/src/shared/streamUtils.ts`

**Option A (recommended):** Convert to thin deprecated re-exports that throw or warn, pointing to `createFramedStreamCodec`.

**Option B:** Keep as module-level functions that require a serializer parameter (breaking change for all callers).

**Decision: Option A with migration shim** — keep file, mark deprecated, delegate to a module-level default only in tests. All production code uses `FramedStreamCodec` from DI.

Actually cleaner: **delete JSON from streamUtils**, replace entire file content with:

```typescript
/** @deprecated Import createFramedStreamCodec and bind to components.serializer */
export { createFramedStreamCodec } from './serialization/framedStreamCodec';
```

Update all callers in same PR — no shim needed since all callers are in `@dechat/core`.

---

### H. `packages/core/src/networking/PeerAuthenticator.ts`

**Changes:**
1. Add `private readonly framedStream: FramedStreamCodec` from `components.serializer`
2. Replace `readFromStream` / `writeToStream` with `this.framedStream.*`

---

### I. `packages/core/src/networking/PeerExchangeService.ts`

**Changes:**
1. Add `private readonly serializer: WireCodec` and `private readonly framedStream: FramedStreamCodec`
2. **Pubsub gossip path (line ~195):** `JSON.stringify(msg)` → `this.serializer.serialize(msg)`
3. **Pubsub listener (line ~239):** `JSON.parse(uint8ArrayToString(data))` → `this.serializer.deserialize(data)`
4. **Stream paths:** `writeToStream` / `processDataFromStream` → `framedStream` methods
5. Remove `uint8ArrayFromString` / `uint8ArrayToString` where replaced

---

### J. `packages/core/src/networking/utils.ts`

**Changes:**
1. `processDataFromStream` — either:
   - Remove and inline into `PeerExchangeService` via `framedStream.readMessagesFromStream`, OR
   - Change signature to `(stream, serializer, onMessage, onError)` 
   
**Decision:** Remove `processDataFromStream` from utils; `PeerExchangeService` uses `framedStream` directly. Keeps utils focused on sampling/dial helpers.

---

### K. `packages/core/src/data-convergence/AntiEntropyNetworkExchange.ts`

**Changes:**
1. Add `private readonly framedStream: FramedStreamCodec` from `components.serializer`
2. Replace `setupRPCStream(...)` → `this.framedStream.setupRPCStream(...)`

---

### L. `packages/core/src/data-replication/KReplicaContentReplication.ts`

**Changes:**
```diff
- import { getGenericDataSerailizer } from '../shared/serializers';
- this.serializer = getGenericDataSerailizer();
+ this.serializer = components.serializer;
```

Remove direct factory import.

---

### M. `packages/core/src/data-replication/TopicBasedContentReplication.ts`

Same change as KReplicaContentReplication.

---

### N. `packages/core/src/data-replication/content-hash/Sha256ContentHashStrategy.ts`

**Changes:**
```diff
- import { canonicalSerialize } from '../../shared/serializers';
+ import { canonicalSerialize } from '../../shared/serialization/canonicalSerializer';
```

No logic change.

---

### O. `packages/core/src/data-replication/replication-protocol/ReplicationProtocolInterface.ts`

**Changes:**
```diff
  export interface ReplicationContent {
    type: 'replication_content';
    hash: ContentHash;
-   replicationContent: Array<number>;
+   replicationContent: Uint8Array;
  }
```

CBOR natively encodes `Uint8Array` as bytes. Remove `Array.from()` / `new Uint8Array(array)` conversions at call sites.

---

### P. `packages/core/src/data-replication/replication-protocol/ReplicationMessageProtocolManager.ts`

**Changes (line ~107, ~132):**
```diff
- replicationContent: Array.from(result.data),
+ replicationContent: result.data,  // already Uint8Array

- const bytes = new Uint8Array(msg.payload.replicationContent);
+ const bytes = msg.payload.replicationContent;
```

---

### Q. `packages/core/src/data-replication/KReplicaContentReplication.ts` & `TopicBasedContentReplication.ts`

**Changes (response handling ~line 167/212):**
```diff
- const rawBytes = new Uint8Array(response.replicationContent);
+ const rawBytes = response.replicationContent;
```

---

### R. `packages/core/index.ts`

Update exports:
```typescript
export {
  createCborWireSerializer,
  createJsonWireSerializer,
  createFramedStreamCodec,
  canonicalSerialize,
  WIRE_FORMAT,
} from './src/shared/serialization';
export type { WireCodec, FramedStreamCodec, DataSerializer } from './src/shared/serialization';

/** @deprecated Use createCborWireSerializer or createJsonWireSerializer */
export { createJsonWireSerializer as getGenericDataSerailizer } from './src/shared/serialization';
```

---

## Test File Updates

| File | Changes |
|---|---|
| `tests/unit/data-replication/canonicalSerializer.unit.test.ts` | Update import to `serialization/canonicalSerializer` |
| `tests/unit/data-propagation/GossipSubPropagation.unit.test.ts` | Add mock `serializer` to `mockComponents`; encode test event data with mock serializer |
| `tests/unit/data-propagation/DirectStreamPropagation.unit.test.ts` | Add mock `serializer` to `mockComponents` |
| `tests/unit/networking/PeerAuthenticator.unit.test.ts` | Mock `createFramedStreamCodec` or pass mock serializer + use real framed codec |
| `tests/unit/networking/PeerExchangeService.unit.test.ts` | Add mock serializer; update pubsub test payloads to CBOR bytes |
| `tests/unit/data-replication/KReplicaContentHashReplication.unit.test.ts` | Mock serializer already present — no change needed |
| `tests/unit/data-replication/ReplicationMessageProtocolManager.unit.test.ts` | Change `replicationContent: [9, 9]` → `new Uint8Array([9, 9])` |
| `tests/unit/replica-store/InMemoryReplicationStorage.unit.test.ts` | Use `createCborWireSerializer()` instead of `getGenericDataSerailizer()` |
| `tests/unit/replica-store/LevelDBReplicaStore.unit.test.ts` | Verify mock serializer still works |
| `tests/unit/data-convergence/AntiEntropyNetworkExchange.unit.test.ts` | Add serializer to mock components; update if stream mocks needed |
| `tests/interop/childThread/nodeWorker.ts` | Replace hand-rolled `JSON.parse` on pubsub data with `components.serializer.deserialize` |
| `tests/interop/childThread/nodeWorkerData.ts` | Same; replace ping payload JSON encoding with serializer |
| `tests/interop/childThread/workerUitls.ts` | No change expected — uses `createNode` which sets serializer |

---

## Out of Scope (Phase 2+)

- Protobuf schemas for `PropagatedMessage` / `ReplicationMessage`
- Worker-thread decode offload for messages > 64KB
- `packages/examples/chat/utils.ts` — update in follow-up if it hand-rolls JSON on streams
- Changing `canonicalSerialize` algorithm or content hash version
- Network-wide migration negotiation protocol (format byte is sufficient for Phase 1)

---

## Implementation Order

Execute in this sequence to keep tests green at each step:

### Step 1 — Foundation (no caller changes yet)
- [ ] Add `cbor-x` dependency
- [ ] Create `shared/serialization/` module (types, utils, canonical, json, cbor codecs)
- [ ] Add unit tests for codecs
- [ ] Create `framedStreamCodec.ts` + unit tests
- [ ] Add barrel `index.ts`

### Step 2 — Wire propagation & streams
- [ ] Refactor `GossipSubPropagation` to use `components.serializer`
- [ ] Refactor `DirectStreamPropagation` to use `FramedStreamCodec`
- [ ] Refactor `PeerAuthenticator` to use `FramedStreamCodec`
- [ ] Refactor `PeerExchangeService` (pubsub + streams)
- [ ] Refactor `AntiEntropyNetworkExchange`
- [ ] Remove JSON from `streamUtils.ts` / `networking/utils.processDataFromStream`
- [ ] Update propagation & networking unit tests

### Step 3 — Replication DI fix
- [ ] Fix `KReplicaContentReplication` → `components.serializer`
- [ ] Fix `TopicBasedContentReplication` → `components.serializer`
- [ ] Change `ReplicationContent.replicationContent` to `Uint8Array`
- [ ] Update `ReplicationMessageProtocolManager` and replication unit tests

### Step 4 — Node wiring & exports
- [ ] Default `createNode` to `createCborWireSerializer()`
- [ ] Update `packages/core/index.ts` exports
- [ ] Deprecate `shared/serializers.ts` (shim re-exports)

### Step 5 — Interop & verification
- [ ] Update interop worker files to use serializer from components
- [ ] Run `yarn workspace @dechat/core test` — all unit tests pass
- [ ] Run `yarn workspace @dechat/core build`
- [ ] Run `yarn test:int:startup` — worker teardown clean
- [ ] Run `yarn test:int:data-sync` — replication still converges

---

## Verification Checklist

- [ ] No file in `packages/core/src` calls `JSON.stringify` / `JSON.parse` for wire messages (except inside `jsonWireSerializer.ts` and `canonicalSerializer.ts`)
- [ ] No file calls `getGenericDataSerailizer()` directly except deprecated shim and tests
- [ ] GossipSub publish and receive use same codec
- [ ] Direct streams and GossipSub produce different framing but same format byte + CBOR body
- [ ] `Uint8Array` in `PropagatedMessage.signature` round-trips correctly
- [ ] `ReplicationContent.replicationContent` is `Uint8Array` end-to-end
- [ ] Content hashes unchanged — `canonicalSerializer.unit.test.ts` passes without logic changes
- [ ] Worker interop tests terminate cleanly (no hung threads)

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Breaking wire compat with running nodes | Format byte + JSON fallback in deserialize; all nodes must upgrade together pre-production |
| CBOR extension types differ across versions | Pin `cbor-x` version; test round-trip in unit + interop |
| Replica store contains old JSON bytes | Phase 1: treat missing format byte as JSON legacy in `decodeWireEnvelope` |
| Tests mock `streamUtils` directly | Update mocks to mock `createFramedStreamCodec` or inject mock serializer |
| `getGenericDataSerailizer` typo in public API | Keep deprecated alias; add correctly spelled `createCborWireSerializer` export |

---

## File Tree (after implementation)

```
packages/core/src/shared/
├── serialization/
│   ├── index.ts
│   ├── types.ts
│   ├── utils.ts
│   ├── canonicalSerializer.ts      # identity hashing — unchanged logic
│   ├── jsonWireSerializer.ts       # legacy wire format
│   ├── cborWireSerializer.ts       # default wire format
│   └── framedStreamCodec.ts        # length-prefixed stream framing
├── serializers.ts                  # deprecated re-export shim (delete in Phase 2)
├── streamUtils.ts                  # removed or re-exports framedStreamCodec factory
└── types.ts                        # BaseMessage, DataSerializer alias

packages/core/tests/unit/shared/
├── cborWireSerializer.unit.test.ts
├── jsonWireSerializer.unit.test.ts
└── framedStreamCodec.unit.test.ts
```

---

## Approval

**Approved 2026-06-28.** Pre-production: no backward-compat shims. Wire format is configured once via `config.serialization.wireFormat` (`'cbor'` default | `'json'`).

---

## Implementation Status

- [x] Step 1 — Foundation (serialization module + tests)
- [x] Step 2 — Propagation, streams, networking
- [x] Step 3 — Replication DI + Uint8Array
- [x] Step 4 — Node wiring + exports
- [x] Step 5 — Interop verification (`test:int:startup`, `test:int:data-sync`) — CI green on PR #35
