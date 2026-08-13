import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as browser from '../../../browser';

describe('@dechat/core/browser public surface', () => {
  it('exports createBrowserNode and portable strategy factories', () => {
    expect(typeof browser.createBrowserNode).toBe('function');
    expect(typeof browser.portableTopicReplicationStrategies).toBe('function');
    expect(typeof browser.gossipSubPropagation).toBe('function');
    expect(typeof browser.directStreamPropagation).toBe('function');
    expect(typeof browser.contentHashStrategy).toBe('function');
    expect(typeof browser.replicationMessageProtocolManager).toBe('function');
    expect(typeof browser.topicBasedContentHashReplication).toBe('function');
    expect(typeof browser.antiEntropyManager).toBe('function');
    expect(typeof browser.indexedDbReplicaStore).toBe('function');
  });

  it('does not export Node-only composition (TCP, mDNS, LevelDB, createNode)', () => {
    const exports = browser as Record<string, unknown>;
    expect(exports.createNode).toBeUndefined();
    expect(exports.createNodePlatformStack).toBeUndefined();
    expect(exports.LevelDbReplicaStore).toBeUndefined();
    expect(exports.replicaStoreNode).toBeUndefined();
  });

  it('browser entry source does not import Node-only stacks', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../browser.ts'), 'utf8');
    expect(source).not.toMatch(/createNodePlatformStack/);
    expect(source).not.toMatch(/@libp2p\/tcp/);
    expect(source).not.toMatch(/@libp2p\/mdns/);
    expect(source).not.toMatch(/LevelDbReplicaStore/);
    expect(source).not.toMatch(/from '\.\/src\/node'/);
  });
});
