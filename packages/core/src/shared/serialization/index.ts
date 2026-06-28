export { canonicalSerialize } from './canonicalSerializer';
export { createCborWireSerializer } from './cborWireSerializer';
export type { FramedStreamCodec } from './framedStreamCodec';
export { createFramedStreamCodec } from './framedStreamCodec';
export { createJsonWireSerializer } from './jsonWireSerializer';
export type { DataSerializer, WireCodec, WireFormatId, WireFormatName } from './types';
export { WIRE_FORMAT } from './types';
export { normalizeToUint8Array } from './utils';

import { createCborWireSerializer } from './cborWireSerializer';
import { createJsonWireSerializer } from './jsonWireSerializer';
import { WireCodec, WireFormatName } from './types';

/** Creates the wire codec configured for the whole node. */
export const createWireSerializer = (wireFormat: WireFormatName): WireCodec => {
  switch (wireFormat) {
    case 'json':
      return createJsonWireSerializer();
    case 'cbor':
      return createCborWireSerializer();
    default: {
      const exhaustive: never = wireFormat;
      throw new Error(`Unsupported wire format: ${String(exhaustive)}`);
    }
  }
};

/** @deprecated Use createWireSerializer('json') or createJsonWireSerializer() */
export const getGenericDataSerailizer = createJsonWireSerializer;
