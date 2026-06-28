export enum NodeRole {
  EPHEMERAL = 'ephemeral',
  FULL = 'full',
}

export interface BaseMessage<T> {
  id?: string;
  responseCorrelationId?: string;
  payload: T;
}

export type { DataSerializer, WireCodec } from './serialization/types';
