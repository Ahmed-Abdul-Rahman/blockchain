# 🔗 DeChat — Decentralized P2P Networking Network (Libp2p • TypeScript)

[![CI](https://github.com/Ahmed-Abdul-Rahman/blockchain/actions/workflows/ci.yaml/badge.svg)](https://github.com/Ahmed-Abdul-Rahman/blockchain/actions/workflows/ci.yaml)

**DeChat** is an experimental decentralized peer-to-peer networking platform built using **Libp2p** with **TypeScript**.  
Its first milestone is a **serverless encrypted chat network**, and it is designed to later support **blockchain-style transactions** and **decentralized AI agents**.

---

## 🌍 Why this exists

Centralized messaging systems control identity, communication, and data.  
DeChat aims to enable:

- Peer-to-peer identity (no servers)
- Peer-to-peer authentication and communication
- Strong cryptography everywhere
- Scalable & fault-tolerant networking

---

## 🏗️ Repository Structure

```
ahmed-abdul-rahman-blockchain/
├── apps/backend/            # Starts a running node (HTTP + P2P)
│
├── packages/
│   ├── core/                # ★ Core P2P networking layer (Libp2p)
│   ├── crypto/              # Signing, verification, key generation
│   ├── common/              # Logger + shared utils
│   ├── blockchain/          # Optional blockchain logic module
│
└── scripts/                 # Maintenance & utility scripts
```

### Notable core modules (packages/core/src)

- `createDeChatNode.ts` — platform-agnostic composition root
- `platform/` — `Libp2pPlatformStack` adapters (Node TCP/mDNS, Browser WebSockets)
- `networking/` — auth, dial queue, PEX, peer registry, scorer
- `replica-store/` — in-memory, LevelDB (Node), IndexedDB (browser)

### Platform matrix (`@dechat/core`)

| Runtime | Entry | Transports | Discovery | Durable store |
|---------|-------|------------|-----------|---------------|
| Node | `@dechat/core` / `@dechat/core/node` | TCP (+ WS for hybrid) | mDNS + bootstrap | InMemory / LevelDB |
| Browser | `@dechat/core/browser` | WebSockets | bootstrap (required) | InMemory / IndexedDB |

Browser peers must dial at least one **bootstrap** multiaddr (usually a Node peer advertising `/ws`). Do not enable mDNS or TCP listen in the browser profile. See [ADR-0004](docs/adr/0004-platform-agnostic-libp2p-stack.md).

```ts
import { createBrowserNode } from '@dechat/core/browser';

const node = await createBrowserNode(infoHash, seed, {
  config: {
    network: { bootstrapPeers: ['/ip4/…/tcp/…/ws/p2p/…'] },
  },
});
```

---

## 🚀 Getting Started

### Install dependencies

```bash
yarn install
```

### Build all packages

```bash
yarn build
```

### Run a P2P node

```bash
cd apps/backend
yarn start:dev
```

Each node automatically selects a listening port.

---

## 🧪 Testing

### Run all unit tests

```bash
yarn test
```

### Run integration (P2P simulation) tests

```bash
cd packages/core
yarn test:int
```

Integration tests spin multiple worker-thread nodes and validate:

- Peer discovery
- Authentication
- Gossip propagation
- Fair dialing & backoff
- Resilience under churn

---

## 🔧 Current Development Status

🚧 **In active development — breaking changes expected**

What works today:

- Persistent peer identities
- Secure authentication handshake
- Gossip-based peer exchange
- Dial fairness to prevent storms

Next milestones:

1. Fully encrypted chat messaging
2. Offline message delivery
3. Distributed transaction layer
4. Decentralized AI agent execution

---

Note: This project is not a fork of an existing blockchain, it is a clean modular architecture built from the ground up.

---

## 👤 Author

**Ahmed Abdul Rahman**

---

## 📄 License

GPL v3
