export enum NodeRole {
  EPHEMERAL = 'ephemeral',
  FULL = 'full',
}

export interface BaseMessage<T> {
  id?: string;
  responseCorrelationId?: string;
  payload: T;
}

export interface DataSerializer {
  serialize: <T>(data: T) => Uint8Array;
  deserialize: <T>(bytes: Uint8Array) => T;
}
