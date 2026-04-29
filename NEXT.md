# Next Steps (for Future Me)

**Last session:** 2026-29-04
**Branch:** feature/refactor-configs-and-node-initialization

---

## What I just did
- Made KContentHashReplication implementation robust by allowing data replication to happen by using the announce-request mechanism rather than directly replicaing, added requestMissingData, utilized kReplicaContent to store only limited replica's of content across peers.
- Implemented XOR based deterministic mechanism to store replicated data, so a peer can decide if should store this data or not.
- Implemented ReplicationMessageProtocolManager to delegate the network part for data replication, so KContentHashReplication can focus on data replication alone.
- Refactored the entire Core package to a fully modular, Dependency-Injection driven with Inversion of Control driven Architecture with Factory pattern, strategy pattern and interface contracts.
- Now, the refactored version of the core package closely aligns with the js-libp2p's architecture of factory and strategy pattern.
- All the strategies (Data propagation, Data replication, Replica Storage, Serializers) are now pluggable.
- Add more unit tests for each implementation classes, added DHT based requestMissingData interOp testcase
- Added vite test coverage to know the overall test coverage of the code.
- Refactored the entire configuration mechanism to handle multiple config values (delays, timers, counts, replica counts, protocols, topics, etc) - moved all the configs to a dedicated single DeChatConfig source, with default configurations.
- Implemented lifecycle methods (start, stop) using the libp2p's Startable interface for the class that seemed to be having a lifecycle functionality.

## What I am doing
- Refactoring the Core package to be moduler and follow strategy and factory patterns.
- Improving and optimizing the data replication mechanism, by not overwhelming the network with too many replication requestions, using XOR based deterministic mechanism to decide which peer can replicate.
- Adding more unit tests.

## What problem I am solving
- Making the core package modular so we can add more modules(Anti-entropy mdoule) and functionality easily
- Must have a common dedicated configuration mechanism to handle all the config values.
- Data replication should be more optimized, to handle too many replication requests all at once from other peers on the network.


## What to do next (in order)
Refer [BACKLOG](BACKLOG.md) for backlog items what can be picked next.

## Random Improvements/Enhancements/TODO List
- Make Integration tests more configurable (Ex: Control No Of nodes, duration, env variables)
- Verify and Ensure incase of worker thread crashes or any other issues, the integration test harness should always teardown and terminate.
- Add coverage tooling and enforce minimal thresholds in CI.
- Add soak/fuzz tests for malformed gossip/stream payloads.
- Introduce load/perf benchmark scripts and baseline target metrics.

## Open questions / decisions

- Where to store the node seed and how to load it? (private key or node seed to revive the peer incase it crashed)
- Should add a design diagram for the Core package's implementation and working
- Come up with more integration/inter-op tests for the core packge to ensure its reliability and stability.
