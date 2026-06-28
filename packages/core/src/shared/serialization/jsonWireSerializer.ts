import { WIRE_FORMAT, WireCodec } from './types';
import { normalizeToUint8Array, prependFormatId, stripFormatId } from './utils';

const UINT8ARRAY_TAG = '__dechat_uint8array__';

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Uint8Array) {
    return { [UINT8ARRAY_TAG]: Array.from(value) };
  }
  return value;
};

const jsonReviver = (_key: string, value: unknown): unknown => {
  if (value && typeof value === 'object' && UINT8ARRAY_TAG in value) {
    const tagged = value as Record<string, number[]>;
    return new Uint8Array(tagged[UINT8ARRAY_TAG] ?? []);
  }
  return value;
};

export const createJsonWireSerializer = (): WireCodec => ({
  formatId: WIRE_FORMAT.JSON,
  serialize: <T>(data: T): Uint8Array => {
    const payload = new TextEncoder().encode(JSON.stringify(data, jsonReplacer));
    return prependFormatId(WIRE_FORMAT.JSON, payload);
  },
  deserialize: <T>(bytes: Uint8Array): T => {
    const buffer = normalizeToUint8Array(bytes);
    const payload = stripFormatId(buffer, WIRE_FORMAT.JSON);
    const text = new TextDecoder().decode(payload);
    return JSON.parse(text, jsonReviver) as T;
  },
});
