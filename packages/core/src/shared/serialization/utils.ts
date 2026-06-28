import { WIRE_FORMAT, WireFormatId } from './types';

const isBufferJsonRepresentation = (value: unknown): value is { type: 'Buffer'; data: number[] } =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  (value as { type: string }).type === 'Buffer' &&
  'data' in value &&
  Array.isArray((value as { data: unknown }).data);

/** Normalizes worker-thread IPC and other buffer-like inputs to Uint8Array. */
export const normalizeToUint8Array = (input: unknown): Uint8Array => {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (isBufferJsonRepresentation(input)) {
    return new Uint8Array(input.data);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (Array.isArray(input)) {
    return new Uint8Array(input);
  }
  if (
    input &&
    typeof input === 'object' &&
    'length' in input &&
    typeof (input as { length: unknown }).length === 'number'
  ) {
    return new Uint8Array(input as ArrayLike<number>);
  }
  throw new TypeError(`Expected a buffer-like object, received: ${typeof input}`);
};

export const prependFormatId = (formatId: WireFormatId, payload: Uint8Array): Uint8Array => {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = formatId;
  frame.set(payload, 1);
  return frame;
};

export const stripFormatId = (bytes: Uint8Array, expectedFormatId: WireFormatId): Uint8Array => {
  if (bytes.length === 0) {
    throw new Error('Empty wire frame');
  }
  const formatId = bytes[0];
  if (formatId !== expectedFormatId) {
    const expectedLabel = formatId === WIRE_FORMAT.JSON ? 'json' : formatId === WIRE_FORMAT.CBOR ? 'cbor' : 'unknown';
    const configuredLabel =
      expectedFormatId === WIRE_FORMAT.JSON ? 'json' : expectedFormatId === WIRE_FORMAT.CBOR ? 'cbor' : 'unknown';
    throw new Error(
      `Wire format mismatch: configured ${configuredLabel} (0x${expectedFormatId.toString(16)}), received ${expectedLabel} (0x${formatId.toString(16)})`,
    );
  }
  return bytes.subarray(1);
};
