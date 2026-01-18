# History of all the Functionality and Changes made to this repo

Used to keep track of what was implemented.

---

**Session:** 2025-12-07
**Branch:** InterOp/Adding-interoperability-tests

- Implemented p2p integration tests by leveraging worker threads added three scenarios (Burst Startup of peers, Staggered startup and Network Stability peer churn (did peer revived, restored and connected to network))
- Updated dialQueue logic to maintain minimum connections with other peers
- Added some support to restore the peer node's id and details if the node gets restarted.
- Added Github CI with unit-tests and integration-tests jobs
- Migrated from eslint and prettier to biomeJs, replaced husky with lefthook and replaced lodash with es-toolkit


**Session:** 2026-18-01  
**Branch:** improvements/optimizing-code

- Integration with node.ts

Added authenticatinPeers Set data, to avoid authenticating with the same peer
Returns a complete NodeComponents interface with all services accessible
Replaced Map objects with LRUCache in PeerExchangeService and auth

- Metrics & Observability System

MetricsCollector: Tracks connections, peers, dial queue, performance, PEX, and pubsub metrics
HealthChecker: Three-tier health status (HEALTHY/DEGRADED/UNHEALTHY) with configurable thresholds
Prometheus export format for production monitoring
Periodic collection with configurable intervals

- Enhanced Test Output

TestReport interface with detailed metrics summaries
Formatted console output with P50/P95/avg percentiles
Clear pass/fail indicators with specific threshold failures
Applied to all three test scenarios