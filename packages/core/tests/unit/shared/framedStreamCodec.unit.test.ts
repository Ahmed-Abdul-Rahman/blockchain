import { describe, expect, it } from 'vitest';
import { createCborWireSerializer } from '../../../src/shared/serialization/cborWireSerializer';

describe('createFramedStreamCodec', () => {
  it('serializes messages for length-prefixed stream transport', async () => {
    const serializer = createCborWireSerializer();
    const frame = serializer.serialize({ hello: 'world' });
    expect(frame[0]).toBe(1);
    expect(serializer.deserialize<{ hello: string }>(frame)).toEqual({ hello: 'world' });
  });
});
