---
name: typescript
description: TypeScript coding conventions for DeChat — strict typing (no any), procedural-by-default with classes/factories/module-objects chosen deliberately, type-first API design, make-illegal-states-unrepresentable, file organization, naming, and performance/readability patterns. Use when writing or reviewing any .ts file in the monorepo.
---

# TypeScript (DeChat)

Opinionated TypeScript conventions for the DeChat monorepo, curated from [seanpmaxwell/Typescript-Best-Practices](https://github.com/seanpmaxwell/Typescript-Best-Practices) ([README](https://github.com/seanpmaxwell/Typescript-Best-Practices/blob/main/README.md), [Design-Rules](https://github.com/seanpmaxwell/Typescript-Best-Practices/blob/main/Design-Rules.md), [File-Category-Examples](https://github.com/seanpmaxwell/Typescript-Best-Practices/blob/main/File-Category-Examples.md), [types-reference](https://github.com/seanpmaxwell/Typescript-Best-Practices/blob/main/types-reference.ts)), [icyJoseph's js-ts-performance-readability](https://github.com/icyJoseph/agent-skills/blob/main/skills/js-ts-performance-readability/SKILL.md), and the [typescript-expert](https://www.skills.sh/sickn33/antigravity-awesome-skills/typescript-expert) / [typescript-pro](https://www.skills.sh/jeffallan/claude-skills/typescript-pro) / [typescript-best-practices](https://www.skills.sh/0xbigboss/claude-code/typescript-best-practices) skills.

These reinforce `.cursorrules`: **strict TypeScript, never `any`, ES Modules, arrow functions + async/await, `readonly` + pure functions by default.**

## 1. Correctness & trust (type-first)

### Never `any` — narrow from `unknown`

```ts
// Bad
function parse(input: any) { return input.value }

// Good — accept unknown, narrow with a guard
function parse(input: unknown): string {
  if (typeof input === 'object' && input !== null && 'value' in input) {
    return String((input as { value: unknown }).value);
  }
  throw new Error('Invalid input');
}
```

### Make illegal states unrepresentable

Use the type system to prevent invalid states at compile time — discriminated unions over loose optional bags.

```ts
// Bad — allows { status: 'ok', error: '...' } nonsense
type Result = { status: 'ok' | 'error'; data?: Uint8Array; error?: string };

// Good — discriminated union; impossible to hold data AND error
type Result =
  | { status: 'ok'; data: Uint8Array }
  | { status: 'error'; error: string };

function handle(r: Result) {
  if (r.status === 'ok') return r.data;   // r.error not accessible here
  throw new Error(r.error);
}
```

### Explicit types at boundaries; infer internally

- Give **public functions** explicit parameter and return types.
- Let inference handle internal locals/helpers.
- Use `as const` for literal/tuple returns so callers get narrow types: `return [ok, count] as const`.

### Avoid silent coercion

- Parse numbers explicitly (`Number(x)`), validate with `Number.isNaN`.
- Use `??` for "default if missing" (`map.get(k) ?? 0`), not `||` (which trips on `0`/`''`).
- Check absence with `x == null` (covers `null` + `undefined`) and return early.

### Branded types for domain identifiers

Prevent mixing semantically different strings/numbers (peer ids, content hashes, topic ids):

```ts
type PeerId = string & { readonly __brand: 'PeerId' };
type ContentHash = string & { readonly __brand: 'ContentHash' };
const asPeerId = (s: string): PeerId => s as PeerId;
// fn(hash: ContentHash) now rejects a raw PeerId at compile time
```

## 2. Class vs Factory-function vs Module-object

Default to **procedural** code; reach for OOP deliberately. (Design-Rules.md)

### Use a **class** when (most are true)

- It models a specific instance ("this instance") with **internal state that evolves over time**
- Methods act on and mutate that state; recreating it would lose meaningful information
- There's a real lifecycle / need for `this` / `instanceof`

> Examples: data structures (trie index, cache), connections (DB/socket/session), stateful services. DeChat: `TrieBackedReplicaStore`, `PeerRegistry`, replica stores.

### Use a **factory function** when (most are true)

- Behavior is fully determined at creation time; config captured via closures
- The returned object is immediately valid; no meaningful lifecycle; no `this`/inheritance
- Recreating it yields an equivalent result; single initialization step

```ts
function createLogger(level: 'info' | 'debug') {
  return {
    log(message: string) {
      if (level === 'debug') console.debug(message);
      else console.log(message);
    },
  };
}
```

> Examples: loggers, configured clients, validators/formatters, feature-flag evaluators. DeChat: `createNode(strategies)`.

### Use a **module-object / namespace-object** when

- The code is IO or data-transformation; stateless/procedural; no instance identity
- A class would just act as a namespace
- Data is described with **types**, behavior with free functions

```ts
// MailUtils.ts
const mailer = thirdPartyMailer('settings');
function sendMail(opts: MailerOptions): Promise<void> { return mailer.send(opts); }
export default { sendMail } as const;
```

> Do **not** use classes purely as namespaces, and do **not** model IO-data with classes — act upon it with module-objects.

## 3. Objects, enums, types

- **Object states**: `static` (values change, keys don't — TS default), `dynamic` (both change), `readonly` (`as const`). Default to `readonly` where reasonable.
- **Avoid `enum`** — it emits runtime JS. Prefer a `as const` lookup table + declaration merging:

```ts
const UserRoles = { BASIC: 0, ADMIN: 1, OWNER: 2 } as const;
type UserRoles = (typeof UserRoles)[keyof typeof UserRoles]; // 0 | 1 | 2
```

- **`type` vs `interface`**: follow the official TS guidance — use `interface` for object shapes until you need a `type` (unions, mapped/conditional types, utility types). Be consistent within a file.
- **Plain-data objects** (serializable: primitives, arrays, Dates, nested plain-data) matter for anything crossing the worker-thread or network boundary in DeChat:

```ts
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type PlainDataObject = { [k: string]: Primitive | Date | PlainDataObject | PlainDataArray };
type PlainDataArray = (Primitive | Date | PlainDataObject | PlainDataArray)[];
```

## 4. File categories & organization

**File types:** `module` (has imports/exports, locally scoped) vs `script` (no imports/exports, global scope — avoid).

**File categories:**
| Category | Purpose |
|----------|---------|
| **declaration** | Exports one declared item (a large function/config object) |
| **module-object** | `export default { ... } as const` organizing one file's logic |
| **inventory** | Many independent exports (shared types, small utils) — export inline |
| **linear** | Executes a sequence of commands (startup/setup) |

**Top-down region order** (respects hoisting): Docs → Constants → Types → Run/Setup → Components (`.tsx`) → Functions → Classes → Export. Separate exports of declaration/module-object/linear files at the bottom; inventory files export inline.

```ts
/******************************************************************************
                                  Constants
******************************************************************************/
// ... region separators like this; sections like:
// -------------------------- Setup middleware --------------------------- //
```

## 5. Naming conventions

| Thing | Convention |
|-------|-----------|
| Folders | `kebab-case` (or named after primary export) |
| Linear / inventory files | `kebab-case` |
| Declaration / module-object files | named after the exported item (often `PascalCase`, e.g. `User.model.ts`) |
| `index.ts` | barrel/entry point for a **library** folder |
| `main.ts` | starting point for an **application** |
| Readonly primitives/arrays | `UPPER_SNAKE_CASE` |
| Functions | `camelCase` (PascalCase only for JSX, constructors, value-factories) |
| Classes / Types | `PascalCase` |
| Booleans | prefix `is` |

**Function name prefixes/suffixes:**
- `get…` returns non-IO data; `fetch…` returns IO data (`await fetchUserRecords()`).
- `is…` for validator functions returning type predicates: `isValidUser(x: unknown): x is User`.
- `…OrThrow` to distinguish a throwing variant from a nullable one.
- Suffixes for data movement: `View` (server→client render), `DTO` (in-memory movement), `Payload` (through an API), `Label` (UI-formatted string).

## 6. Comments

- `/** */` above **every function-declaration**; `//` (or none) for function-expressions.
- `/** */` for complex utility-types.
- Inline `//` for explanations; capitalize and punctuate.
- Useful tags: `@private`, `@testOnly`, `@cronJob`, `@startupTime`; for DB entities `@entity table`, `@auxiliaryOf`, `@joins`, and column tags `// @PK`, `// @FK 1-1`, `// @AC`.
- Per `.cursorrules`: **no narration comments** ("// increment counter"). Comments explain *why*, not *what*.

## 7. Imports & shared code

- Group imports by origin: **libraries → application → local**; split long lists across lines.
- Shared categories: `utils` (pure runtime logic, no IO, no cross-imports of runtime logic → avoids dependency loops), `constants` (readonly values), `types` (compile-time only), `ui` (`.tsx`).
- Use a `common/` folder in branch-directories and `local/` in focused-directories. **Never** use dumping-ground names (`misc/`, `helpers/`, `shared/`, bare `utils.ts`) outside the sanctioned shared categories.

## 8. Performance & readability (icyJoseph)

### Model the problem first
Clarify inputs/outputs/constraints and enumerate edge cases **before** coding: empty input, single element, boundary values (`0`, negatives, `MAX_SAFE_INTEGER`), malformed input, duplicates, order sensitivity.

### Data structures & algorithms
- Use `Set` for "visited/seen" and `Map` for frequency counts / keyed caches: `freq.set(k, (freq.get(k) ?? 0) + 1)`.
- Parse input **once**; reuse the parsed structure. Memoize repeated computation with a deterministic string cache key.
- Prefer single-pass: `.find` / `.findLast` over double scans; `.flatMap` / `.reduce` over `.filter().map()` chains when one pass suffices; `toSorted` for a sorted copy.

### Async: parallelize independent work
```ts
// Bad — sequential, sum of latencies
const a = await fetchA();
const b = await fetchB();

// Good — concurrent, max of latencies
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```
- `Promise.all` for independent work (fails fast); `Promise.allSettled` when you need every result regardless of failures; `Promise.race` for timeouts.
- **Eliminate waterfalls** (`.cursorrules`): defer `await` until the value is needed.

### Common traps
- Compile regex **once** outside loops (`const re = /…/g`).
- Don't repeatedly `JSON.parse`/`stringify` — parse once, pass the object.
- Don't defensively clone everything; use spread / `structuredClone` only when mutation is a real concern.
- Build large strings with array + `.join()`, not `+=` in a tight loop.

### Structure for readability
- Small named helpers (`sum`, `groupBy`, `keyBy`, `chunk`, `unique`, `clamp`) named by intent.
- Separate parsing / processing / output; a thin `main()`/`run()` orchestrates stages.
- `const` by default, `let` only when reassigned; early returns over deep nesting.
- One pattern per module for error handling (throw, `Result` type, or `null`) — don't mix.

## 9. Monorepo / tooling (DeChat)

- **ES Modules** everywhere; never break inter-package imports across the Yarn workspaces.
- Keep the package dependency graph **acyclic**; `utils`-style packages must not import runtime logic from feature packages.
- Run `tsc --noEmit` (or `yarn build`) to catch type errors before claiming done; aim for zero errors.
- Lint/format via the repo's Biome config; respect `readonly` and pure-function defaults.

## Quick checklist before submitting TS

- [ ] No `any`; `unknown` narrowed via guards/predicates
- [ ] Illegal states unrepresentable (discriminated unions, branded ids)
- [ ] Public functions have explicit param + return types; `as const` where it sharpens types
- [ ] Right tool: class (stateful instance) vs factory (configured, no lifecycle) vs module-object (IO/data)
- [ ] No `enum`; lookup-table + declaration merge instead
- [ ] File category clear; regions ordered; naming conventions followed
- [ ] Map/Set for lookups; independent async parallelized; no waterfalls; regex/parse hoisted
- [ ] `/** */` on function-declarations; no narration comments
- [ ] `tsc --noEmit` clean; ESM imports intact; no new dependency cycles

## Related skills

| Skill | Use for |
|-------|---------|
| `/nodejs-core` | Runtime internals: event loop, worker threads, streams, profiling |
| `/codebase-design` | Designing deep-module seams these conventions live in |
| `/tdd` | Test-first workflow with DeChat unit/integration conventions |
