/** Redis key helpers shared by Compose node entrypoint and orchestrator. */

export const readyKey = (index: number): string => `ready:${index}`;
export const addrsKey = (index: number): string => `addrs:${index}`;
export const cmdKey = (index: number): string => `cmd:${index}`;
export const evtKey = (index: number): string => `evt:${index}`;
export const statsKey = (index: number): string => `stats:${index}`;

export const BARRIER_PRODUCERS_MESH = 'barrier:producers-mesh';
export const BARRIER_PRODUCERS_DONE = 'barrier:producers-done';
