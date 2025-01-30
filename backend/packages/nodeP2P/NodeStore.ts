import { isNodeObjectType, NodeObject, NodesStore } from './dataTypes';
import { ACTIVE, HSK_IN_PRGS, LOCKED } from './messageTypes';

export class NodeStore {
  private nodeStore: NodesStore;

  constructor() {
    this.nodeStore = new Map<string, NodeObject>();
    this.pruneInActiveNodes();
  }

  getSize(): number {
    return this.nodeStore.size;
  }

  getNodeData(nodeId: string): NodeObject | undefined {
    return this.nodeStore.get(nodeId);
  }

  getNodeDataProp<K extends keyof NodeObject>(nodeId: string, property: K): NodeObject[K] | undefined {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return undefined;
    return nodeData[property];
  }

  getNodeEntries(): NodeObject[] {
    return Array.from(this.nodeStore.values());
  }

  getNodeURL(nodeId: string, port: string | number | null): string | null {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return null;
    if (port) this.updateNodeData(nodeId, { port });
    return `http://${nodeData?.nodeAddress}:${port}`;
  }

  getNodeCurrentTimeline(nodeId: string): string | null {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData || !nodeData.timeline) {
      console.log(`NodeData does not exist for node: ${nodeId}`);
      return null;
    }
    return nodeData.timeline[nodeData.timeline.length - 1];
  }

  updateNodeData(nodeId: string, data: NodeObject | object): void {
    const targetNodeData = this.nodeStore.get(nodeId);
    if (targetNodeData) this.nodeStore.set(nodeId, { ...targetNodeData, ...data, lastUpdated: Date.now() });
    else if (typeof data === 'object' || isNodeObjectType(data))
      this.nodeStore.set(nodeId, { ...data, lastUpdated: Date.now() } as NodeObject);
  }

  updateNodeCurrentTimeline(nodeId: string, currentStage: string): void {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return;
    nodeData.timeline.push(currentStage);
  }

  deleteNode(nodeId: string): boolean {
    return this.nodeStore.delete(nodeId);
  }

  hasNode(peerId: string): boolean {
    return this.nodeStore.has(peerId);
  }

  isAnyConnectionInProgress(): boolean {
    return Array.from(this.nodeStore.values()).some(({ status }) => status === HSK_IN_PRGS);
  }

  isNodeStatusLocked(nodeId: string): boolean {
    const targetNodeData = this.nodeStore.get(nodeId);
    if (targetNodeData) return targetNodeData.status === LOCKED;
    return false;
  }

  isEveryNodeAcknowledged(value: string): boolean {
    return this.getNodeEntries().every(({ requestStatus }) => requestStatus === value);
  }

  // prune nodes that are still in the initial stages (ex: status is still INFO_HASH_EXG or NETWORK_DATA_EXG)
  pruneInActiveNodes(): void {
    setInterval(() => {
      let inActiveNodesPruned = 0;
      Array.from(this.nodeStore.values()).forEach(({ nodePeerId, status, lastUpdated }) => {
        if (status !== ACTIVE && Date.now() - lastUpdated > 900000) {
          this.nodeStore.delete(nodePeerId?.toString() as string);
          inActiveNodesPruned += 1;
        }
      });
      console.log(`Pruned ${inActiveNodesPruned} in active nodes from store`);
    }, 900000);
  }
}
