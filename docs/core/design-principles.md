## Design Principle

Best Practices:
- Use robust discovery (DHTs or trusted bootstrap nodes).
- Design for eventual consistency and idempotent operations.
- Implement peer authentication and reputation systems to reduce abuse.
- Add replication and caching to improve availability.
- Monitor network health and provide incentives for peers to stay online


Data Replication Design choices:
- Storage-agnostic
- Transport-agnostic
- Consensus-agnostic
- Data-type agnostic

- The replication layer is intentionally content-addressed and semantics-agnostic.
Conflict resolution and state convergence are delegated to higher-level protocols (e.g. CRDTs, blockchains).

Replication decides what to store,
Convergence ensures eventual correctness,
ReplicaStore decides where and how data lives.