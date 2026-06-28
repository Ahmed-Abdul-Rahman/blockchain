import { describe, expect, it } from 'vitest';
import { createCborWireSerializer } from '../../../src/shared/serialization/cborWireSerializer';
import { WIRE_FORMAT } from '../../../src/shared/serialization/types';
import { normalizeToUint8Array } from '../../../src/shared/serialization/utils';

describe('createCborWireSerializer', () => {
  const serializer = createCborWireSerializer();

  it('prefixes frames with the CBOR format byte', () => {
    const bytes = serializer.serialize({ hello: 'world' });
    expect(bytes[0]).toBe(WIRE_FORMAT.CBOR);
  });

  it('round-trips primitives and nested objects', () => {
    const input = { id: 'msg-1', count: 42, nested: { ok: true }, tags: ['a', 'b'] };
    const output = serializer.deserialize<typeof input>(serializer.serialize(input));
    expect(output).toEqual(input);
  });

  it('round-trips Uint8Array fields', () => {
    const signature = new Uint8Array([1, 2, 3, 255]);
    const input = { id: 'signed', signature };
    const output = serializer.deserialize<typeof input>(serializer.serialize(input));
    expect(output.signature).toBeInstanceOf(Uint8Array);
    expect(Array.from(output.signature)).toEqual([1, 2, 3, 255]);
  });

  it('rejects frames with a mismatched format byte', () => {
    const jsonFrame = new Uint8Array([WIRE_FORMAT.JSON, 123]);
    expect(() => serializer.deserialize(jsonFrame)).toThrow(/Wire format mismatch/);
  });

  it('normalizes worker Buffer JSON representations', () => {
    const input = { value: 7 };
    const bytes = serializer.serialize(input);
    const workerLike = { type: 'Buffer', data: Array.from(bytes) };
    expect(serializer.deserialize<typeof input>(normalizeToUint8Array(workerLike))).toEqual(input);
  });
});
