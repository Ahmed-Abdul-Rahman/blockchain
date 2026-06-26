---
name: implement
description: "Implement a piece of work based on a PRD or set of issues."
disable-model-invocation: true
---

Implement the work described by the user in the PRD or issues.

Read `.cursor/PROJECT.md` for build commands, architecture anchors, and P2P constraints before starting.

Use `/tdd` where possible, at pre-agreed seams.

## During implementation

- Read `CONTEXT.md` for domain vocabulary; respect `docs/core/` specs and any ADRs in `docs/adr/`.
- Follow `.cursorrules` — especially auth-before-registry and throttled dialing.
- For multi-step work with architectural decisions, write a plan to `tasks/todo.md` first and get approval.
- Run typechecking and single test files frequently:
  - `yarn core test:file packages/core/tests/unit/<area>/<Module>.unit.test.ts`
- Place new unit tests at `packages/core/tests/unit/<area>/<Module>.unit.test.ts`.

## Before declaring done

1. `yarn test` — all unit tests pass.
2. If the change touches P2P, replication, propagation, or node wiring: `yarn build && yarn test:int`.
3. `yarn lint` — no biome errors.
4. Confirm worker threads are torn down in any new interop scenarios (`terminateWorkers()` + `await Promise.all(terminationPromises)`).
5. Review your own diff for P2P constraint violations.

Do **not** commit unless the user explicitly asks.
