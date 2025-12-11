# 🧠 AI Interaction Rules for This Repository

This document contains instructions for **any AI assistant** (ChatGPT, Claude, Gemini, Cursor, GitHub Copilot, etc.) when generating code or guidance for this project.

---

## 📌 Project Identity

This repository implements a **decentralized P2P networking system** using **Libp2p (TypeScript)**.  
Primary goals:

- Fully decentralized encrypted chat (first milestone)
- Expandable to blockchain transactions & distributed state
- Future support for decentralized AI agent execution

---

## ✔️ General Rules for AI

1. **Preserve the existing architecture** — monorepo with Yarn workspaces.
2. **Never break inter-package imports or public interfaces**.
3. **Everything must be ES modules (`import` / `export`)**.
4. **TypeScript only — do NOT introduce `any`**.
5. **Use immutable patterns (`readonly`, pure functions) where reasonable.**

---

## ✔️ P2P Networking Rules

- Authentication MUST occur before exposing other protocols.
- Never accept or store a peer in `PeerRegistry` until **authentication succeeds**.
- Avoid **connection storms** — dialing MUST be scheduled/fair/throttled.
- Use existing mechanisms rather than guessing:
  - `PeerScorer`
  - `DialQueue`
  - `PeerExchangeService`
  - `shouldDial`

---

## ✔️ Code Quality Rules

- Always follow a clean modular approach.
- Use Single Responsibility Principles wherever necessary
- Don't add comments in between code unless it is a complex logic.
- Add a jsdoc comment at the top of function if it does some complex operations.
- When add member functions or class variables or creating classes always add jsdoc to explain it.
- Always include types (`types.ts`) for new modules.
- Prefer `Map`, `Set`, `Result<T,E>` patterns over untyped objects.
- All errors must be explicit and logged through the `logger` in `packages/common`.
- Use Arrow Functions where ever possible.
- Use Async/Await for asynchronous tasks.
- Avoid using loops try to use in-built iteration functions. (Can use loops if they are running indefinitely or doing complex scheduling tasks)
- Provide return types for funcitons, add types for params.
- Use es-toolkit functions wherever possible

---

## ✔️ Testing Rules

- Unit tests live in `*.unit.test.ts` — fast, isolated.
- Integration tests live in `*.int.ts` — worker-thread P2P simulations.
- Integration tests must CLEAN UP all workers before finishing.

---

## ❌ NOT allowed unless explicitly requested

- Rewriting the project structure
- Migrating away from Libp2p without justification
- Adding consensus/VM/tokenomics prematurely
- Introducing frameworks unrelated to the core architecture

---

## 🧭 Roadmap Guidance for AI

When expanding or modifying this project:

1. Upgrade networking core (reliability, auth, scoring)
2. Implement encrypted chat protocol
3. Add distributed transaction layer
4. Later integrate decentralized AI agent execution

---

### Summary

The AI can suggest improvements in the architecture consider the following aspects when suggesting (Performance, Scalability, Maintainability, InterOperability, Modularity, Readability, Extensability, Reusability, Security)
Provide deterministic, typed, incremental improvements that respect the modular design.
