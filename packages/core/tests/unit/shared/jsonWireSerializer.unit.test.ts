import { describe, expect, it } from 'vitest';
import { createJsonWireSerializer } from '../../../src/shared/serialization/jsonWireSerializer';
import { WIRE_FORMAT } from '../../../src/shared/serialization/types';

describe('createJsonWireSerializer', () => {
  const serializer = createJsonWireSerializer();

  it('prefixes frames with the JSON format byte', () => {
    const bytes = serializer.serialize({ hello: 'world' });
    expect(bytes[0]).toBe(WIRE_FORMAT.JSON);
  });

  it('round-trips objects', () => {
    const input = { id: 'msg-1', payload: { text: 'hello' } };
    expect(serializer.deserialize(serializer.serialize(input))).toEqual(input);
  });

  it('round-trips Uint8Array fields via tagged encoding', () => {
    const input = { signature: new Uint8Array([9, 8, 7]) };
    const output = serializer.deserialize<typeof input>(serializer.serialize(input));
    expect(Array.from(output.signature)).toEqual([9, 8, 7]);
  });
});
