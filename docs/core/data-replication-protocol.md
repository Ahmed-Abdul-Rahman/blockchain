# Replication Protocol Specification (v1)

## 1. Overview

The Replication Protocol defines how peers in the network:

- Announce availability of data
- Retrieve missing data on demand
- Distribute data to a bounded set of peers (K-replication)
- Avoid duplication, overload, and network amplification

The protocol follows a **hybrid push–pull model**:

> **Push (announce + targeted replication)**  
> **Pull (on-demand retrieval + anti-entropy compatibility)**

---

## 2. Design Goals

### 2.1 MUST

The protocol MUST:

- Be **content-addressed** (identity via content hash)
- Support **deterministic K-replication**
- Support **ephemeral nodes (stateless restart)**
- Avoid **network amplification storms**
- Be **idempotent**
- Be **eventually consistent**
- Support **backpressure and retry**

### 2.2 MUST NOT

The protocol MUST NOT:

- Broadcast full payloads indiscriminately
- Require global coordination
- Depend on consensus or ordering

---

## 3. Core Concepts

### 3.1 Content Hash

All data is identified by:

```text
ContentHash = hash(data)
```

Properties:

- Deterministic
- Collision-resistant
- Globally unique identifier

### 3.2 Replica Responsibility

Each data item is stored by:

```text
K = replicaCount
```

Top K peers are selected via peer scoring.

### 3.3 Message Types

The protocol defines four message types:

| Type     | Purpose                         |
|----------|---------------------------------|
| ANNOUNCE | Notify peers that data exists   |
| REQUEST  | Ask for data                    |
| CONTENT  | Deliver data                    |
| ERROR    | Signal failure                  |

---

## 4. Message Definitions

### 4.1 ANNOUNCE

Broadcast message indicating availability of content.

```ts
{
  type: "replication_announce",
  hash: ContentHash,
  from: PeerId,
  timestamp: number
}
```

Constraints:

- MUST be lightweight (no payload)
- MUST be broadcast via gossip

### 4.2 REQUEST

Direct message requesting specific content.

```ts
{
  type: "replication_request",
  hash: ContentHash
}
```

Constraints:

- MUST be sent via direct propagation
- SHOULD be retried on failure

### 4.3 CONTENT

Direct message delivering content.

```ts
{
  type: "replication_content",
  hash: ContentHash,
  payload: Uint8Array
}
```

Constraints:

- MUST only be sent if data exists locally
- MUST match hash integrity

### 4.4 ERROR

Indicates failure to serve content.

```ts
{
  type: "replication_error",
  hash: ContentHash,
  reason: "not_found" | "overloaded"
}
```

## 5. Protocol Flow

### 5.1 Local Data Production

When a node produces new data:

1. Compute hash
2. Persist locally
3. Broadcast `ANNOUNCE(hash)`
4. Direct-send `CONTENT` to top K peers

### 5.2 Receiving ANNOUNCE

```ts
if storage.has(hash) {
  // ignore
} else if (inflight.has(hash)) {
  // ignore
} else {
  inflight.add(hash)
  sendRequest(hash, announcingPeer)
}
```

### 5.3 Receiving REQUEST

```ts
if (storage.has(hash)) {
  sendContent(hash, payload)
} else {
  sendError(hash, "not_found")
}
```

Optional behavior:

- MAY send `ERROR("overloaded")` under pressure

### 5.4 Receiving CONTENT

```ts
if (storage.has(hash)) {
  // ignore
} else {
  persistData(hash, payload)
  // MAY trigger replication if selected as K
}
```

## 6. In-Flight Request Control

Each node MUST maintain:

```ts
const inflightRequests = new Set<ContentHash>()
```

Rules:

- MUST NOT send duplicate `REQUEST` for the same hash while inflight
- MUST remove hash after:
  - successful `CONTENT`
  - retry exhaustion

## 7. Retry Policy

`REQUEST` messages SHOULD follow exponential backoff:

```ts
delay = baseDelay * 2 ** attempt
```

Recommended defaults:

| Parameter   | Value |
|-------------|-------|
| maxAttempts | 3     |
| baseDelay   | 200ms |

Retry triggers:

- network failure
- `ERROR("overloaded")`

Retry MUST NOT occur on:

- `ERROR("not_found")`

## 8. Overload Handling

Nodes MAY reject requests with:

- `ERROR("overloaded")`

When:

- upload queue exceeds threshold
- CPU/memory pressure detected

Peers receiving overload:

- SHOULD retry with backoff
- SHOULD NOT immediately retry

## 9. Idempotency Rules

All operations MUST be idempotent:

- Duplicate `ANNOUNCE` → ignored
- Duplicate `REQUEST` → safe
- Duplicate `CONTENT` → ignored if already stored

## 10. Storage Requirements

Nodes MUST maintain a replica store with the following API:

```ts
interface ReplicaStore {
  has(hash: ContentHash): boolean
  get(hash: ContentHash): Uint8Array | undefined
  put(hash: ContentHash, payload: Uint8Array): void
  delete(hash: ContentHash): void
  inventory(): ContentHash[]
}
```

Storage MAY be:

- in-memory (ephemeral node)
- persistent (full node)
- distributed (e.g., OrbitDB)

## 11. Transport Requirements

| Operation | Transport              |
|-----------|------------------------|
| ANNOUNCE  | Broadcast (Gossip)     |
| REQUEST   | Direct                 |
| CONTENT   | Direct                 |
| ERROR     | Direct                 |

## 12. Security Considerations

Nodes SHOULD:

- Verify hash integrity of received `CONTENT`
- Ignore malformed messages
- Apply peer scoring to avoid malicious nodes
- Limit inbound request rate

## 13. Consistency Model

The protocol provides:

- Eventual consistency

Guarantees:

- Data will converge across replicas over time
- No guarantee of immediate consistency
- No ordering guarantees

## 14. Failure Scenarios

| Scenario           | Behavior                                  |
|-------------------|-------------------------------------------|
| Node restart      | Rehydrate via announce + pull             |
| Network partition | Heal via announce + anti-entropy          |
| Peer failure      | K-replication ensures redundancy          |
| Overload          | Backoff + retry                           |

## 15. Extensions (Future)

The protocol is designed to support:

- Anti-entropy (inventory exchange)
- Bloom filter announcements
- Merkle DAG sync
- Partial replication / sharding
- Consensus integration
