# Next Steps (for Future Me)

**Last session:** 2025-12-07  
**Branch:** InterOp/Adding-interoperability-tests

---

## What I just did

- Implemented p2p integration tests by leveragin worker threads added three scenarios (Burst Startup of peers, Staggered startup and Network Stability peer churn (did peer revived, restored and connected to network))
- Updated dialQueue logic to maintain minimum connections with other peers
- Added some support to restore the peer node's id and details if the node gets restarted.

## What problem I was solving

- Ensuring the Core package p2p implementation is robust and stable by implementing Integration and Inter-Operability tests to test the core package's network reliabiltiy and stability.

## What to do next (in order)

1. Migrate to es-toolkit and biomeJs for better performance and code quality
2. Ensure incase of worker thread crashes or any other issues, the integration test harness should always teardown and terminate.
3. Implement Github Actions build pipeline for the project.

## Random Improvements/Enhancements/TODO List

- Make Integration tests more configurable (Ex: Control No Of nodes, duration, env variables)
- Implement data replication and data propagation mechanism between peers in the network. (This should be an in-built functionality of the core package)

## Open questions / decisions

- Where to store the node seed and how to load it? (private key or node seed to revive the peer incase it crashed)
- Should add a design diagram for the Core package's implementation and working
- Come up with more integration/inter-op tests for the core packge to ensure its reliability and stability.
