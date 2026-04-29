import { Level } from 'level';
import { DataSerializer } from '../data-replication/types';
import { DeChatComponents, DeChatFactory } from '../types';
import { ReplicaStoreInterface } from './ReplicaStoreInterface';

export class LevelDbReplicaStore implements ReplicaStoreInterface {
  private db: Level<string, Buffer>;
  public serializer: DataSerializer;

  constructor(components: DeChatComponents) {
    this.db = new Level(components.config.strategies.store.dbPath, { valueEncoding: 'binary' });
    this.serializer = components.serializer;
  }

  async has(hash: string): Promise<boolean> {
    try {
      await this.db.get(hash);
      return true;
    } catch {
      return false;
    }
  }

  async get(hash: string): Promise<Uint8Array | null> {
    try {
      const v = await this.db.get(hash);
      return new Uint8Array(v);
    } catch {
      return null;
    }
  }

  async put(hash: string, data: Uint8Array): Promise<void> {
    await this.db.put(hash, Buffer.from(data));
  }

  async delete(hash: string): Promise<void> {
    await this.db.del(hash);
  }

  async keys(): Promise<readonly string[]> {
    const out: string[] = [];
    for await (const k of this.db.keys()) out.push(k.toString());
    return out;
  }

  async values(): Promise<readonly Uint8Array[]> {
    const out: Uint8Array[] = [];
    for await (const [, v] of this.db.iterator()) out.push(new Uint8Array(v));
    return out;
  }

  async entries(): Promise<MapIterator<[string, Uint8Array<ArrayBufferLike>]>> {
    const m = new Map<string, Uint8Array>();
    for await (const [k, v] of this.db.iterator()) m.set(k.toString(), new Uint8Array(v));
    return m.entries();
  }

  async clear(): Promise<void> {
    // naive clear: iterate and delete
    const keys: string[] = [];
    for await (const k of this.db.keys()) keys.push(k.toString());
    await Promise.all(keys.map((k) => this.db.del(k)));
  }

  async size(): Promise<number> {
    let n = 0;
    for await (const _ of this.db.keys()) n++;
    return n;
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export const levelDbReplicaStore = (): DeChatFactory<ReplicaStoreInterface> => {
  return (components) => new LevelDbReplicaStore(components);
};
