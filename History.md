# History of all the Functionality and Changes made to this repo

Used to keep track of what was implemented.

---

- Implemented p2p integration tests by leveraging worker threads added three scenarios (Burst Startup of peers, Staggered startup and Network Stability peer churn (did peer revived, restored and connected to network))
- Updated dialQueue logic to maintain minimum connections with other peers
- Added some support to restore the peer node's id and details if the node gets restarted.
- Added Github CI with unit-tests and integration-tests jobs
- Migrated from eslint and prettier to biomeJs, replaced husky with lefthook and replaced lodash with es-toolkit