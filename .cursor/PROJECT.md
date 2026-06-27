# DeChat — Project Configuration for Agent Skills

Project-specific settings referenced by skills in `.cursor/skills/`. Replaces the upstream `setup-matt-pocock-skills` flow.

## Repository

| Item | Value |
|------|-------|
| **Name** | DeChat |
| **Monorepo** | Yarn 4 workspaces |
| **Primary package** | `@dechat/core` (`packages/core`) |
| **GitHub** | `Ahmed-Abdul-Rahman/de-chat` |
| **Default branch** | `develop` |
| **License** | GPL v3 |

## Issue Tracker (GitHub Issues)

Use `gh` for all issue/PR operations when available.

### Triage label mapping

Every triaged issue carries **one category** and **one state** label.

**Category labels:**

| Canonical role | GitHub label |
|----------------|--------------|
| `bug` | `bug` |
| `enhancement` | `enhancement` |

**State labels:**

| Canonical role | GitHub label |
|----------------|--------------|
| `needs-triage` | `needs-triage` |
| `needs-info` | `needs-info` |
| `ready-for-agent` | `ready-for-agent` |
| `ready-for-human` | `ready-for-human` |
| `wontfix` | `wontfix` |

Create labels with:

```bash
chmod +x scripts/create-github-triage-labels.sh
./scripts/create-github-triage-labels.sh
```

Requires `gh auth login`. Idempotent — skips labels that already exist.

### Out-of-scope knowledge base

Rejected enhancement requests are recorded in `.out-of-scope/*.md` (create the directory when first needed).

## Domain documentation

| Resource | Path |
|----------|------|
| Domain glossary | `CONTEXT.md` (repo root) |
| ADRs | `docs/adr/` — `0001-topic-based-replication-for-chat-rooms.md`, `0002-tombstone-event-sourcing-for-deletions.md` |
| Replication protocol spec | `docs/core/data-replication-protocol.md` |
| Design principles | `docs/core/design-principles.md` |
| Agent coding rules | `.cursorrules` |
| Sprint notes | `NEXT.md` |
| Backlog | `BACKLOG.md` |

## Build & verify commands

| Task | Command |
|------|---------|
| Install | `yarn install` |
| Build all packages | `yarn build` |
| Unit tests (all workspaces) | `yarn test` |
| Unit tests (core only) | `yarn core test` |
| Single unit test file | `yarn core test:file packages/core/tests/unit/<path>/<Module>.unit.test.ts` |
| Coverage (core) | `yarn core test:coverage` |
| Integration tests (P2P interop, full) | `yarn build && yarn test:int` |
| Integration tests (P2P interop, narrow) | `yarn build && yarn test:int:narrow` (3 nodes, 30s) |
| Lint | `yarn lint` |
| Lint fix | `yarn lint:fix` |
| Run a P2P node | `cd apps/backend && yarn start:dev` |
| Multi-node sim | `yarn core sim` |

**Integration tests require `yarn build` first** — they run compiled JS from `dist/tests/interop/`.

## Testing conventions

| Type | Pattern | Location |
|------|---------|----------|
| Unit | `*.unit.test.ts` | `packages/core/tests/unit/**` |
| Integration | `*.int.ts` | `packages/core/tests/interop/**` |

- Unit tests: fast, mocked at **system boundaries** (libp2p, `@noble/ed25519`, `level`).
- Integration tests: real libp2p in worker threads; **must** call `terminateWorkers()` or CI hangs.
- Mock pattern: build `Partial<DeChatComponents>` in `beforeEach`; call `.stop()` in `afterEach`.
- Reference wiring: `packages/core/tests/interop/childThread/workerUitls.ts` → `configureNode()`.

## Architecture anchors

| Concern | Entry point |
|---------|-------------|
| Composition root | `packages/core/src/node.ts` → `createNode()` |
| Config | `packages/core/src/config/` |
| Networking | `packages/core/src/networking/` |
| Broadcast propagation | `packages/core/src/data-propagation/broadcast/GossipSubPropagation.ts` |
| Direct propagation | `packages/core/src/data-propagation/direct/DirectStreamPropagation.ts` |
| K-replica replication | `packages/core/src/data-replication/KReplicaContentReplication.ts` |
| Topic replication | `packages/core/src/data-replication/TopicBasedContentReplication.ts` |
| Anti-entropy | `packages/core/src/data-convergence/` |
| Replica stores | `packages/core/src/replica-store/` |
| Strategy types | `packages/core/src/types.ts` → `DeChatStrategies` |
| P2P design skill | `.cursor/skills/designing-p2p-systems/SKILL.md` |
| libp2p implementation skill | `.cursor/skills/libp2p-core-patterns/SKILL.md` |
| P2P theory / fundamentals | `.cursor/skills/p2p-fundamentals/SKILL.md` |
| libp2p wire-protocol reference | `.cursor/skills/libp2p-spec/SKILL.md` |
| P2P architecture/lifecycle patterns | `.cursor/skills/p2p-design-patterns/SKILL.md` |
| TypeScript conventions | `.cursor/skills/typescript/SKILL.md` |
| Node.js runtime internals | `.cursor/skills/nodejs-core/SKILL.md` |

## P2P constraints (non-negotiable)

1. **Auth first** — never add a peer to `PeerRegistry` until `PeerAuthenticator` succeeds.
2. **Throttled dialing** — use `DialQueue`, `SimplePeerScorer`, `PeerExchangeService`; no ad-hoc connection storms.
3. **Boot lock** — `replicaStore.init()` must complete before libp2p starts when using trie-backed stores.
4. **Worker teardown** — integration tests must terminate all worker threads before finishing.

## Current development stage

- **Active sprint:** Phase 5 wiring — anti-entropy + trie-backed store + topic replication into `createNode`.
- **Works today:** persistent identities, auth handshake, gossip PEX, fair dialing, broadcast/direct propagation, K-replica replication.
- **In progress:** data convergence (anti-entropy), topic-based full replication, handler registry multiplexing.
- **Not built yet:** encrypted chat app layer, E2EE, offline delivery, web UI (`apps/web`), decentralized AI agents.
- **Legacy coexistence:** `apps/backend` HTTP API + `@dechat/blockchain` PoW chain run alongside but are separate from the P2P chat path.

## Code style

- Strict TypeScript, no `any` (use `unknown` + narrow).
- ESM everywhere; arrow functions; `es-toolkit` for data manipulation.
- Biome for lint/format (2-space, 120 cols, single quotes).
- Errors logged via `@dechat/common` logger.
