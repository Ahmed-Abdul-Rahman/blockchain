export interface BaseMessage<T> {
  id?: string;
  responseCorrelationId?: string;
  payload: T;
}

export type AntiEntropyMessage =
  | { type: 'REQUEST_TOP_N'; levels: number }
  | { type: 'RESPONSE_TOP_N'; snapshot: string }
  | { type: 'REQUEST_BRANCHES'; prefixes: string }
  | { type: 'RESPONSE_BRANCHES'; branches: string };
