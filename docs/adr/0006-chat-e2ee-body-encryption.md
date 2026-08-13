---
status: accepted
---

# Encrypt chat message bodies; keep envelope metadata in the clear

Chat replication is content-addressed and room-scoped (ADR-0001, ADR-0005). Payloads in the replica store and on REQUEST/CONTENT are visible to any member who stores them. We encrypt **only the message body** (text + unsigned display name) with a per-room AES-256-GCM key so the CAS holds ciphertext. Routing fields stay plaintext: `roomId`, `messageId`, `senderPeerId`, `timestamp`, `keyEpoch`.

Sender **Ed25519** signs `roomId || messageId || keyEpoch || nonce || ciphertext`. The envelope carries `senderPublicKey`; verifiers reject a signature whose public key does not match `senderPeerId` (same binding as auth).

**Room keys never enter the replica store.** They live in the ChatClient process. On join, a member without a key asks verified peers over a Noise direct stream (`/deChat/v1/protocol/room-key`); a member who already has the key offers it. The first member of an empty peer set creates epoch 1. `leaveRoom` discards local keys. `rotateRoomKey` bumps the epoch for remaining members; automatic rotate-on-remote-leave waits on presence (open rooms have no membership roster).

Open rooms (v1): any verified peer who joins can obtain the current key. E2EE here means ciphertext at rest and on the replication path, not a closed group. X25519 wrapping of the room key (so Noise cannot see it) is a later hardening.

## Considered options

| Option | Why rejected |
|--------|----------------|
| **Encrypt the whole envelope** | Replication and room-scope need `roomId` to index and gate pulls |
| **Derive the room key from roomId** | Anyone who knows the id can decrypt; not E2EE |
| **MLS / sender keys** | Correct for large closed groups; too much protocol for v1 |
| **Keep plaintext in CAS, rely on Noise** | Bootstrap peers and IndexedDB would store readable history |
| **Body AES-GCM + in-memory keys over authenticated streams** | **Chosen.** Matches “ciphertext-only in replica store” |

## Consequences

- Projection decrypts with the matching `keyEpoch`; unknown epochs are omitted, not shown as plaintext.
- Tombstones stay unencrypted metadata (they have no body).
- UI may say messages are encrypted at rest; capability-closed rooms and key wrapping come later.
