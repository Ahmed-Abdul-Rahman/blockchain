export type ContentHash = string;

export enum NodeRole {
  EPHEMERAL = 'ephemeral',
  FULL = 'full',
}

export interface DataSerializer {
  serialize: <T>(data: T) => Uint8Array;
  deserialize: <T>(bytes: Uint8Array) => T;
}
