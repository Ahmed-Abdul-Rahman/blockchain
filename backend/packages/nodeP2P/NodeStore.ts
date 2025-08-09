import { cloneDeep, has, isArray, isEqual, isNull, isNumber, isString, merge, set, unionWith } from 'lodash-es';
import { generateTimestamp } from '@common/utils';

import { ACTIVE } from './messageTypes';
import { isNodeObjectType, NodeObject, NodesStore } from './types';

export class NodeStore {
  private nodeStore: NodesStore;

  constructor(registerCleanUp: boolean = true) {
    this.nodeStore = new Map<string, NodeObject>();
    if (registerCleanUp) this.pruneInActiveNodes();
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

  getNodeEntries(sparse?: boolean): NodeObject[] | Partial<NodeObject>[] {
    if (sparse)
      return Array.from(this.nodeStore.values()).map(({ nodeAddress, nodePeerId, port, status }) => ({
        nodeAddress,
        nodePeerId,
        port,
        status,
      }));
    return Array.from(this.nodeStore.values());
  }

  getNodeURL(nodeId: string, port: string | number | null): string | null {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return null;
    if (port) this.updateNodeData(nodeId, port, 'port');
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

  updateNodeDatabeta(nodeId: string, data: NodeObject | object): void {
    const targetNodeData = this.nodeStore.get(nodeId);
    if (targetNodeData) this.nodeStore.set(nodeId, { ...targetNodeData, ...data, lastUpdated: Date.now() });
    else if (typeof data === 'object' || isNodeObjectType(data))
      this.nodeStore.set(nodeId, { ...data, lastUpdated: Date.now() } as NodeObject);
  }

  updateNodeData(
    nodeId: string,
    data: NodeObject | object | string | number | string[] | null,
    property?: keyof NodeObject,
  ): void {
    if (!this.nodeStore.has(nodeId)) {
      if (typeof data !== 'object' || isString(data) || isNumber(data) || isArray(data) || isNull(data)) {
        throw new Error('Expected NodeObject for new entries.');
      }
      set(data, 'lastUpdated', generateTimestamp());
      this.nodeStore.set(nodeId, cloneDeep(data) as NodeObject);
    } else {
      const existingData = this.nodeStore.get(nodeId);
      if (!existingData) return;

      if (typeof data === 'object' && !isString(data) && !isArray(data)) {
        merge(existingData, { ...data, lastUpdated: generateTimestamp() });
        this.nodeStore.set(nodeId, existingData);
      } else if (isString(data) || isNumber(data) || isArray(data) || isNull(data)) {
        if (property && has(existingData, property)) {
          set(existingData, property, data);
          set(existingData, 'lastUpdated', generateTimestamp());
          this.nodeStore.set(nodeId, existingData);
        } else {
          throw new Error('When providing a value, property must also be specified.');
        }
      }
    }
  }

  updateNodeCurrentTimeline(nodeId: string, currentStage: string): void {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return;
    nodeData.timeline?.push(currentStage);
    set(nodeData, 'lastUpdated', Date.now());
  }

  updateNodeStore(nodes: NodeObject[]): void {
    const isNodeEqual = (sourceVal, otherVal) => {
      if (isEqual(sourceVal, otherVal)) return true;
      if (sourceVal.nodePeerId === otherVal.nodePeerId) return true;
      return false;
    };
    this.nodeStore = new Map<string, NodeObject>(
      unionWith(Array.from(this.nodeStore.values()), nodes, isNodeEqual).map((node) => [
        node.nodePeerId,
        set(node, 'lastUpdated', Date.now()),
      ]),
    );
  }

  deleteNode(nodeId: string): boolean {
    return this.nodeStore.delete(nodeId);
  }

  hasNode(peerId: string): boolean {
    return this.nodeStore.has(peerId);
  }

  // prune nodes that are still in the initial stages (ex: status is still INFO_HASH_EXG or NETWORK_DATA_EXG)
  pruneInActiveNodes(): NodeJS.Timeout {
    const intervalId = setInterval(() => {
      let inActiveNodesPruned = 0;
      Array.from(this.nodeStore.values()).forEach((node) => {
        const { nodePeerId, status, lastUpdated } = node;
        if (status !== ACTIVE && Date.now() - lastUpdated > 900000) {
          this.nodeStore.delete(nodePeerId);
          inActiveNodesPruned += 1;
        }
        console.log(node);
      });
      console.log(`Pruned ${inActiveNodesPruned} inactive nodes from store`);
    }, 10000);
    return intervalId;
  }
}
