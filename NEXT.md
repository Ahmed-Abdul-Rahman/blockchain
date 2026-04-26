# Next Steps (for Future Me)

**Last session:** 2026-07-02
**Branch:** feature/data-replication

---

## What I just did


## What I am doing

## What problem I am solving


## What to do next (in order)
1. Implement Anti-Entropy data convergence mechanism 
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
