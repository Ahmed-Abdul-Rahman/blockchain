import { cloneDeep, has, isArray, isEqual, isNull, isNumber, isString, merge, set, unionWith } from 'lodash-es';
import { generateTimestamp } from '@common/utils';

import { ACTIVE } from './messageTypes';
import { ChallengeEntry, isNodeObjectType, isPropOfNodeObject, NodeObject, NodesStore } from './types';

export class NodeStore {
  private nodeStore: NodesStore;
  private _challenges: Map<string, ChallengeEntry> = new Map();
  private _challengeTtlMs = 2 * 60 * 1000; // 2 minutes by default

  constructor(registerCleanUp: boolean = true) {
    this.nodeStore = new Map<string, NodeObject>();
    if (registerCleanUp) this.pruneInActiveNodes();
    this.enableChallengeGc();
  }

  /**
   *  returns the number of nodes present in store
   * @returns {number}
   */
  getSize(): number {
    return this.nodeStore.size;
  }

  /**
   *  returns the node data object of a given nodeId if present
   * @param nodeId
   * @returns {NodeObject | undefined}
   */
  getNodeData(nodeId: string): NodeObject | undefined {
    return this.nodeStore.get(nodeId);
  }

  /**
   * returns the value of a property specified with in the node if present
   * @param nodeId
   * @param property
   * @returns
   */
  getNodeDataProp<K extends keyof NodeObject>(nodeId: string, property: K): NodeObject[K] | undefined {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return undefined;
    return nodeData[property];
  }

  /**
   *  returns all the nodes present in the store
   * @param sparse boolean to specify if the data returned should be complete or sparse
   * @returns {NodeObject[] | Partial<NodeObject>[]}
   */
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

  /**
   *  if the node exists returns the a http url to connect
   * @param nodeId
   * @param port
   * @returns {string | null}
   */
  getNodeURL(nodeId: string, port: string | number | null): string | null {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return null;
    if (port) this.updateNodeData(nodeId, port, 'port');
    return `http://${nodeData?.nodeAddress}:${port}`;
  }

  /**
   *  returns a node's latest/current timeline
   * @param nodeId
   * @returns {string | null}
   */
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

  /**
   *  update node data of a nodeId or insert a new node if does not exist
   * @param nodeId
   * @param data A NodeObject or object or string or number or string[] or null
   * @param property optional property - required if the data is string or number
   * @returns
   */
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
        if (property && (has(existingData, property) || isPropOfNodeObject(property))) {
          set(existingData, property, data);
          set(existingData, 'lastUpdated', generateTimestamp());
          this.nodeStore.set(nodeId, existingData);
        } else {
          throw new Error('When providing a value, property must also be specified.');
        }
      }
    }
  }

  /**
   *  update the timeline property of a node
   * @param nodeId
   * @param currentStage
   * @returns
   */
  updateNodeCurrentTimeline(nodeId: string, currentStage: string): void {
    const nodeData = this.nodeStore.get(nodeId);
    if (!nodeData) return;
    nodeData.timeline?.push(currentStage);
    set(nodeData, 'lastUpdated', Date.now());
  }

  /**
   * Add multiple nodes to the store
   * @param {NodeObject[]} nodes
   */
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

  /**
   * delete a node from store
   * @param nodeId
   * @returns
   */
  deleteNode(nodeId: string): boolean {
    return this.nodeStore.delete(nodeId);
  }

  /**
   * check if a node exists in store
   * @param peerId
   * @returns
   */
  hasNode(peerId: string): boolean {
    return this.nodeStore.has(peerId);
  }

  /**
   * prune nodes that are still in the initial stages (ex: status is still INFO_HASH_EXG or NETWORK_DATA_EXG)
   * @returns intervalId - {NodeJS.Timeout}
   */
  private pruneInActiveNodes(): NodeJS.Timeout {
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

  /**
   *  add the challenge to the challenges store
   * @param nodeId
   * @param nonce
   * @param remoteAddr
   * @param ttlMs
   */
  addChallenge(nodeId: string, nonce: string, remoteAddr?: string, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttlMs ?? this._challengeTtlMs);
    this._challenges.set(nodeId, { nonce, expiresAt, requestedAt: now, remoteAddr });
  }

  /**
   * get the challenge entry of a node if not expired
   * @param nodeId
   * @returns {ChallengeEntry | null}
   */
  getChallenge(nodeId: string): ChallengeEntry | null {
    const challengeEntry = this._challenges.get(nodeId);
    if (!challengeEntry) return null;
    if (Date.now() > challengeEntry.expiresAt) {
      this._challenges.delete(nodeId);
      return null;
    }
    return challengeEntry;
  }

  /**
   * consume the challenge and mark as complete/delete from store
   * @param nodeId
   * @returns {ChallengeEntry | null}
   */
  consumeChallenge(nodeId: string): ChallengeEntry | null {
    const challengeEntry = this.getChallenge(nodeId);
    if (!challengeEntry) return null;
    this._challenges.delete(nodeId);
    return challengeEntry;
  }

  /**
   *
   * @param intervalMs
   * periodically clears challenges that are expired call this funciton only once during init
   */
  private enableChallengeGc(intervalMs = 60_000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this._challenges.entries()) {
        if (value.expiresAt <= now) this._challenges.delete(key);
      }
    }, intervalMs);
  }
}
