import { PeerId } from '@libp2p/interface';
import { get, set } from 'lodash-es';

import { ACTIVE, HSK_IN_PRGS, LOCKED, REJECT_REASON_TIMED_OUT, REQUEST_WAS_DEFERRED } from './messageTypes';
import { customRejectError, isNodeObjectType, NodeObject, NodesStore, PingDetails } from './types';

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

  getNodeDataProp(
    nodeId: string,
    propertyPath: string,
  ): string | string[] | number | PeerId | PingDetails | null | undefined {
    const nodeDataObj = this.nodeStore.get(nodeId);
    if (!nodeDataObj) return undefined;
    return get(nodeDataObj, propertyPath);
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

  updateNodeProp(nodeId: string, propertyPath: string | string[], value: unknown): void {
    const targetNodeData = this.nodeStore.get(nodeId);
    if (!targetNodeData) return;
    set(targetNodeData, propertyPath, value);
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

  isEveryNodeAcknowledged(nodeId: string): Promise<boolean> {
    const MAX_RETRIES = 7;
    const POLLING_INTERVAL = 100;
    const nodesCount = this.nodeStore.size - 1; // Take a snapshot of the size so it wont change when interval executes. -1 to exclude the new node that is to be dialed
    let intervalCounter = 0;

    return new Promise((resolve, reject) => {
      if (!this.nodeStore.has(nodeId))
        return reject({ reason: `Node ${nodeId} does not exist in node store` } as customRejectError);

      const intervalId = setInterval(() => {
        const { replyCounter, deferCounter, stopExec } = this.getNodeDataProp(nodeId, 'pingDetails') as PingDetails;
        if (stopExec) {
          reject({ reason: REQUEST_WAS_DEFERRED });
          return;
        }
        if (deferCounter >= 1) {
          // if a deferred response came in resolve with false right away
          clearInterval(intervalId);
          this.updateNodeProp(nodeId, 'pingDetails.waitingForAck', false);
          resolve(false);
          return;
        }
        if (replyCounter + deferCounter === nodesCount) {
          clearInterval(intervalId);
          this.updateNodeProp(nodeId, 'pingDetails.waitingForAck', false);
          resolve(deferCounter < 1); // if replyCounter is full size then true otherwise false
        }
        if (intervalCounter++ >= MAX_RETRIES) {
          clearInterval(intervalId);
          this.updateNodeProp(nodeId, 'pingDetails.waitingForAck', false);
          const isMajorityAcknowledged = this.isMajorityAcknowledged.bind(this, nodeId, nodesCount);
          reject({ reason: REJECT_REASON_TIMED_OUT, isMajorityAcknowledged } as customRejectError);
        }
      }, POLLING_INTERVAL);
    });
  }

  isMajorityAcknowledged(nodeId: string, nodesCount: number, threshold: number = 70): boolean {
    const { replyCounter } = this.getNodeDataProp(nodeId, 'pingDetails') as PingDetails;
    const percentage = (replyCounter / nodesCount) * 100;
    return percentage >= threshold;
  }

  // prune nodes that are still in the initial stages (ex: status is still INFO_HASH_EXG or NETWORK_DATA_EXG)
  pruneInActiveNodes(): void {
    setInterval(() => {
      let inActiveNodesPruned = 0;
      Array.from(this.nodeStore.values()).forEach((node) => {
        const { nodePeerId, status, lastUpdated } = node;
        if (status !== ACTIVE && Date.now() - lastUpdated > 900000) {
          this.nodeStore.delete(nodePeerId?.toString() as string);
          inActiveNodesPruned += 1;
        }
        console.log(node);
      });
      console.log(`Pruned ${inActiveNodesPruned} in active nodes from store`);
    }, 120000);
  }
}
