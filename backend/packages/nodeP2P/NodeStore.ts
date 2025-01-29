import { PeerId } from '@libp2p/interface';

import { isNodeObjectType, NodeObject, NodesStore } from './dataTypes';
import { ACTIVE, HSK_IN_PRGS, LOCKED } from './messageTypes';

export class NodeStore {
  private nodeStore: NodesStore;

  constructor() {
    this.nodeStore = new Map<string, NodeObject>();
  }

  getSize(): number {
    return this.nodeStore.size;
  }

  getNodeData(nodeId: string): NodeObject | undefined {
    return this.nodeStore.get(nodeId);
  }

  getNodeDataProp(nodeId: string, property: string): PeerId | string | string[] | number | undefined | null {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return undefined;
    return nodeData[property];
  }

  updateNodeData(nodeId: string, data: NodeObject | object): void {
    const targetNodeData = this.nodeStore.get(nodeId);
    if (targetNodeData) this.nodeStore.set(nodeId, { ...targetNodeData, ...data, lastUpdated: Date.now() });
    else if (typeof data === 'object' || isNodeObjectType(data))
      this.nodeStore.set(nodeId, { ...data, lastUpdated: Date.now() } as NodeObject);
  }

  deleteNode(nodeId: string): boolean {
    return this.nodeStore.delete(nodeId);
  }

  getNodeURL(nodeId: string, port: string | number | null): string | null {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return null;
    if (port) this.updateNodeData(nodeId, { port });
    return `http://${nodeData.nodeAddress}:${port}`;
  }

  getNodeCurrentTimeline(nodeId: string): string | null {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData || !nodeData.timeline) {
      console.log(`NodeData does not exist for node: ${nodeId}`);
      return null;
    }
    return nodeData.timeline[nodeData.timeline.length - 1];
  }

  updateNodeCurrentTimeline(nodeId: string, currentStage: string): void {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return;
    nodeData.timeline.push(currentStage);
  }

  isAnyConnectionInProgress(): boolean {
    const nodes = this.nodeStore.values();
    for (const { status } of nodes) if (status === HSK_IN_PRGS) return true;
    return false;
  }

  isNodeStatusLocked(nodeId: string): boolean {
    const targetNodeData = this.nodeStore.get(nodeId);
    if (targetNodeData) return targetNodeData.status === LOCKED;
    return false;
  }

  // prune nodes that are still in the initial stages (ex: status is still INFO_HASH_EXG or NETWORK_DATA_EXG)
  pruneInActiveNodes(): void {
    setInterval(() => {
      let inActiveNodesPruned = 0;
      this.nodeStore.forEach(({ nodePeerId, status, lastUpdated }) => {
        if (status !== ACTIVE || Date.now() - lastUpdated > 300000) {
          this.nodeStore.delete(nodePeerId?.toString() as string);
          inActiveNodesPruned += 1;
        }
      });
      console.log(`Pruned ${inActiveNodesPruned} in active nodes from store`);
    }, 300000);
  }
}
