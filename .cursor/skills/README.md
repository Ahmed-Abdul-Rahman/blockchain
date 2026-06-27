# Engineering Skills (DeChat)

Agent skills adapted for the DeChat monorepo. Sourced from [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering), customized with DeChat-specific context.

**Spec:** every skill follows the [Agent Skills specification](https://agentskills.io/specification) — each is a folder with a `SKILL.md` (YAML frontmatter: `name` matching the folder + `description`, both required), supporting docs under `references/`, and executable code under `scripts/`. `SKILL.md` files stay under 500 lines; detail loads on demand via `references/` (progressive disclosure).

**Project config:** `.cursor/PROJECT.md` — commands, issue tracker labels, architecture anchors, P2P constraints.

**Domain glossary:** `CONTEXT.md` — ubiquitous language (no implementation details).

## User-invoked

Reachable only when you type them (`disable-model-invocation: true`).

- **[grill-with-docs](./grill-with-docs/SKILL.md)** — Grilling session that sharpens domain terminology and updates `CONTEXT.md` and ADRs inline.
- **[triage](./triage/SKILL.md)** — Move GitHub issues through a state machine of triage roles.
- **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)** — Scan for deepening opportunities, present as HTML report, then grill through your pick.
- **[to-issues](./to-issues/SKILL.md)** — Break a plan or PRD into vertical-slice GitHub issues.
- **[to-prd](./to-prd/SKILL.md)** — Turn the current conversation into a PRD and publish to GitHub issues.
- **[prototype](./prototype/SKILL.md)** — Throwaway terminal prototype for state/logic questions (default for DeChat — no UI yet).
- **[implement](./implement/SKILL.md)** — Implement work from a PRD or issues with DeChat verify steps.

## Model-invoked

Model- or user-reachable (rich trigger phrasing so the model can reach for them).

- **[diagnosing-bugs](./diagnosing-bugs/SKILL.md)** — Diagnosis loop for hard bugs and performance regressions, with DeChat-specific feedback loops.
- **[tdd](./tdd/SKILL.md)** — Test-driven development with DeChat unit/integration conventions.
- **[domain-modeling](./domain-modeling/SKILL.md)** — Build and sharpen the domain model in `CONTEXT.md` and `docs/adr/`.
- **[codebase-design](./codebase-design/SKILL.md)** — Deep module vocabulary with DeChat seam examples.
- **[resolving-merge-conflicts](./resolving-merge-conflicts/SKILL.md)** — Resolve git merge/rebase conflicts with DeChat build/test checks.
- **[designing-p2p-systems](./designing-p2p-systems/SKILL.md)** — CAP/consistency, replication strategy, anti-entropy, and P2P anti-patterns for DeChat.
- **[libp2p-core-patterns](./libp2p-core-patterns/SKILL.md)** — Implementation patterns for `createNode`, auth, PEX, propagation, replication, and interop tests.
- **[p2p-fundamentals](./p2p-fundamentals/SKILL.md)** — Core P2P theory: models, discovery, DHT/Kademlia, content addressing, chunking, replication, churn, CAP trade-offs.
- **[libp2p-spec](./libp2p-spec/SKILL.md)** — libp2p wire-protocol reference: peer ids, multiaddr, connection upgrade, Noise/yamux, identify, GossipSub v1.1, kad-dht, relay/DCUtR.
- **[p2p-design-patterns](./p2p-design-patterns/SKILL.md)** — Node/peer lifecycle, event handling, layered stack, and state-management patterns distilled from ethereumjs-monorepo.
- **[typescript](./typescript/SKILL.md)** — Strict typing, class/factory/module-object decisions, type-first APIs, file organization, naming, and performance/readability conventions.
- **[nodejs-core](./nodejs-core/SKILL.md)** — Runtime internals: event loop, thread pool, worker threads, streams/backpressure, V8 GC/JIT, memory leaks, profiling.

## Fit assessment for DeChat

| Skill | Fit | Notes |
|-------|-----|-------|
| **tdd** | Excellent | Core has 13 unit tests + interop harness; skill now references DeChat mock boundaries |
| **diagnosing-bugs** | Excellent | P2P bugs need disciplined loops; skill now lists unit vs interop feedback paths |
| **codebase-design** | Excellent | Strategy/DI architecture maps directly to deep-module vocabulary |
| **domain-modeling** | Excellent | New `CONTEXT.md` gives the glossary this skill needs |
| **implement** | Good | Adapted with `yarn test` / `yarn test:int` verify gates |
| **prototype** | Good | Defaults to LOGIC branch + worker-thread harness for P2P questions |
| **improve-codebase-architecture** | Good | Seeded with known friction points (anti-entropy gaps, wiring) |
| **grill-with-docs** | Good | Works for replication/convergence design decisions |
| **resolving-merge-conflicts** | Good | Generic skill + DeChat check commands |
| **designing-p2p-systems** | Excellent | DeChat-native — fills gap no public skill covers |
| **libp2p-core-patterns** | Excellent | DeChat-native — implementation guide for `@dechat/core` |
| **p2p-fundamentals** | Excellent | Knowledge base from awesome-p2p, p2p-workshop, bugfree.ai, ByteByteGo, Simson M — grounds DeChat decisions in theory |
| **libp2p-spec** | Excellent | Condensed from libp2p/specs — wire-level reference for anything crossing the network boundary |
| **p2p-design-patterns** | Excellent | Architecture/lifecycle/event patterns distilled from ethereumjs-monorepo (devp2p) |
| **typescript** | Excellent | Reinforces `.cursorrules` (no `any`, ESM, procedural-first) with curated TS conventions; applies to every `.ts` file |
| **nodejs-core** | Excellent | Runtime internals tailored to DeChat's worker-thread interop harness and stream-based propagation |
| **triage / to-issues / to-prd** | Good | Wired to GitHub issues via `.cursor/PROJECT.md`; create triage labels on first use |
| **ask-matt** | Excluded | Router skill — not needed |
| **setup-matt-pocock-skills** | Excluded | Replaced by `.cursor/PROJECT.md` |
