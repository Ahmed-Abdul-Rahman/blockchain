/** Wire format identifiers — first byte of every serialized frame */
export const WIRE_FORMAT = {
  JSON: 0x00,
  CBOR: 0x01,
} as const;

export type WireFormatId = (typeof WIRE_FORMAT)[keyof typeof WIRE_FORMAT];

export type WireFormatName = 'cbor' | 'json';

/** Wire encoding for network + storage. Distinct from canonical content hashing. */
export interface WireCodec {
  readonly formatId: WireFormatId;
  serialize<T>(data: T): Uint8Array;
  deserialize<T>(bytes: Uint8Array): T;
}

export type DataSerializer = WireCodec;
