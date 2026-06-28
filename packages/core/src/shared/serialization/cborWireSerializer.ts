import { Decoder, Encoder } from 'cbor-x';
import { WIRE_FORMAT, WireCodec } from './types';
import { normalizeToUint8Array, prependFormatId, stripFormatId } from './utils';

const encoder = new Encoder({ useRecords: false, structuredClone: true });
const decoder = new Decoder({ structuredClone: true, mapsAsObjects: true });

export const createCborWireSerializer = (): WireCodec => ({
  formatId: WIRE_FORMAT.CBOR,
  serialize: <T>(data: T): Uint8Array => {
    const payload = encoder.encode(data);
    return prependFormatId(WIRE_FORMAT.CBOR, payload);
  },
  deserialize: <T>(bytes: Uint8Array): T => {
    const buffer = normalizeToUint8Array(bytes);
    const payload = stripFormatId(buffer, WIRE_FORMAT.CBOR);
    return decoder.decode(payload) as T;
  },
});
