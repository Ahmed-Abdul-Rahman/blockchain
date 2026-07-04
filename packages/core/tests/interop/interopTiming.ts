/** Base mesh stabilize time proven at 6 nodes in interop scenarios */
const BASE_MESH_STABILIZE_MS = 120_000;
const MESH_STABILIZE_PER_NODE_MS = 6_000;
const BASE_MESH_NODE_COUNT = 6;

const BASE_REPLICATE_SETTLE_MS = 30_000;
const REPLICATE_SETTLE_PER_NODE_MS = 3_000;

const BASE_LATE_JOINER_POLL_MS = 120_000;
/** Headroom for CI load; 50-node runs have converged near 335s and timed out at 340s */
const LATE_JOINER_POLL_PER_NODE_MS = 10_000;

const PRODUCER_CONSENSUS_POLL_MS = 5_000;
const BASE_PRODUCER_CONSENSUS_EXTRA_MS = 90_000;
const PRODUCER_CONSENSUS_PER_NODE_MS = 5_000;

/** GossipSub mesh formation time scales with producer count */
export const computeMeshStabilizeMs = (totalNodes: number): number =>
  BASE_MESH_STABILIZE_MS + Math.max(0, totalNodes - BASE_MESH_NODE_COUNT) * MESH_STABILIZE_PER_NODE_MS;

/** Allow produced messages to replicate across the full producer mesh */
export const computeReplicateSettleMs = (totalNodes: number): number =>
  BASE_REPLICATE_SETTLE_MS + Math.max(0, totalNodes - BASE_MESH_NODE_COUNT) * REPLICATE_SETTLE_PER_NODE_MS;

/** Strict poll window for late-joiner hasTargetData; scales with node count and sync interval */
export const computeLateJoinerPollTimeoutMs = (totalNodes: number, syncIntervalMs: number): number =>
  Math.max(
    syncIntervalMs * 12 + 60_000,
    BASE_LATE_JOINER_POLL_MS + Math.max(0, totalNodes - BASE_MESH_NODE_COUNT) * LATE_JOINER_POLL_PER_NODE_MS,
  );

/** Poll interval while waiting for producers to reach identical replica counts */
export const computeProducerConsensusPollMs = (): number => PRODUCER_CONSENSUS_POLL_MS;

/** Timeout for producer replica-count consensus before collecting expected hashes */
export const computeProducerConsensusTimeoutMs = (totalNodes: number): number =>
  computeReplicateSettleMs(totalNodes) +
  Math.max(BASE_PRODUCER_CONSENSUS_EXTRA_MS, (totalNodes - BASE_MESH_NODE_COUNT) * PRODUCER_CONSENSUS_PER_NODE_MS);
