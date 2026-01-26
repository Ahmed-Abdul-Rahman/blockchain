# Next Steps (for Future Me)

**Last session:** 2026-26-01  
**Branch:** feature/direct-stream-propagation

---

## What I just did

- Refactored DataPropagationInterface and split it into two categories (broadcast and direct)
- Created DirectPropagationInterface and DirectStreamPropagation class for implementation.
- Modified interop test for adding DirectStreamPropagation test
- Renamed DataPropagationInterface to BroadcastPropagationInterface.

## What problem I was solving

- Adding data propagation mechanisms

## What to do next (in order)

1. Implement data replication and data propagation mechanism between peers in the network. (This should be an in-built functionality of the core package, and implement it as a layer on top of the existing core implementation. It should be pluggable i.e replaceable with another data replication and propagation mechanism)
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
