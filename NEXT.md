# Next Steps (for Future Me)

**Last session:** 2026-29-04
**Branch:** feature/refactor-configs-and-node-initialization

---

## What I just did


## What I am doing


## What problem I am solving


## What to do next (in order)
Refer [BACKLOG](BACKLOG.md) for backlog items what can be picked next.

## Random Improvements/Enhancements/TODO List
- Improve code coverage by adding more test scenarios or improving existing testcase to cover more code.
- Make Integration tests more configurable (Ex: Control No Of nodes, duration, env variables)
- Verify and Ensure incase of worker thread crashes or any other issues, the integration test harness should always teardown and terminate.
- Add coverage tooling and enforce minimal thresholds in CI.
- Add soak/fuzz tests for malformed gossip/stream payloads.
- Introduce load/perf benchmark scripts and baseline target metrics.

## Open questions / decisions

- Where to store the node seed and how to load it? (private key or node seed to revive the peer incase it crashed)
- Should add a design diagram for the Core package's implementation and working
- Come up with more integration/inter-op tests for the core packge to ensure its reliability and stability.
