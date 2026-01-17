# Next Steps (for Future Me)

**Last session:** 2026-18-01  
**Branch:** improvements/optimizing-code

---

## What I just did

- Lifecycle Manager Review

Assessment: Solid state machine design (INITIALIZING → STARTING → RUNNING → STOPPING → STOPPED → ERROR)
Strengths: Event-driven transitions, cleanup task registration, state history tracking
Recommendations: Add error recovery strategies and restart mechanisms

- Integration with node.ts

Added authenticatinPeers Set data, to avoid authenticating with the same peer
Returns a complete NodeComponents interface with all services accessible
Replaced Map objects with LRUCache in PeerExchangeService and auth

- Metrics & Observability System
Full TypeScript implementation of:

MetricsCollector: Tracks connections, peers, dial queue, performance, PEX, and pubsub metrics
HealthChecker: Three-tier health status (HEALTHY/DEGRADED/UNHEALTHY) with configurable thresholds
Prometheus export format for production monitoring
Periodic collection with configurable intervals

- Enhanced Test Output

TestReport interface with detailed metrics summaries
Formatted console output with P50/P95/avg percentiles
Clear pass/fail indicators with specific threshold failures
Applied to all three test scenarios

## What problem I was solving

- Ensuring the Core package p2p implementation is robust and stable by implementing Integration and Inter-Operability tests to test the core package's network reliabiltiy and stability.
- Fixing any bottle necks, and improving the overall node's stability by adding lifeCycle manager that can be used in future to handle the node better.

## What to do next (in order)

1. Implement data replication and data propagation mechanism between peers in the network. (This should be an in-built functionality of the core package, and implement it as a layer on top of the existing core implementation. It should be pluggable i.e replacable with another data replication and propagation mechanism)
2. Need to come up with better Connection Manager strategy (Maintaining min and max connections for each peer) Latest Libp2p version 3.x.x has support for autoDial and minConnections in the connection Manager config check that out.

## Random Improvements/Enhancements/TODO List

- Create Production ready configurations, and ready-made configuration methods to deploy node
- Clean up code, move all constants to a file, organizes all type definitions, refactore code wherever needed.
- Make Integration tests more configurable (Ex: Control No Of nodes, duration, env variables)
- Verify and Ensure incase of worker thread crashes or any other issues, the integration test harness should always teardown and terminate.

## Open questions / decisions

- Where to store the node seed and how to load it? (private key or node seed to revive the peer incase it crashed)
- Should add a design diagram for the Core package's implementation and working
- Come up with more integration/inter-op tests for the core packge to ensure its reliability and stability.
