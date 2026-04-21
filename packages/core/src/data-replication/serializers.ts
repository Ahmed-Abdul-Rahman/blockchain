import { DataSerializer } from './types';

export const canonicalSerialize = (value: unknown): Uint8Array => {
  const encoder = new TextEncoder();
  const seen = new WeakSet<object>();

  const serialize = (input: unknown): string => {
    if (input === null) return 'null';

    const type = typeof input;

    if (type === 'number') {
      if (!Number.isFinite(input as number)) {
        throw new Error('Non-finite numbers are not allowed');
      }
      return JSON.stringify(input);
    }
    if (type === 'boolean') return input ? 'true' : 'false';
    if (type === 'string') return JSON.stringify(input);
    if (type === 'bigint') {
      throw new Error('BigInt is not supported in canonical serialization');
    }
    if (type === 'undefined') {
      return 'null'; // consistent fallback (explicit decision)
    }
    if (type === 'object') {
      if (seen.has(input as object)) {
        throw new Error('Circular reference detected');
      }
      seen.add(input as object);
      if (Array.isArray(input)) {
        const items = input.map((item) => serialize(item));
        return `[${items.join(',')}]`;
      }
      if (input instanceof Date) {
        return JSON.stringify(input.toISOString());
      }
      if (input instanceof Map || input instanceof Set) {
        throw new Error('Map/Set are not supported in canonical serialization');
      }
      const obj = input as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const entries = keys
        .filter((k) => obj[k] !== undefined) // omit undefined
        .map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`);

      return `{${entries.join(',')}}`;
    }
    throw new Error(`Unsupported type in canonical serialization: ${type}`);
  };

  const json = serialize(value);
  return encoder.encode(json);
};

export const getGenericDataSerailizer = (): DataSerializer => ({
  serialize: <T>(data: T): Uint8Array => canonicalSerialize(data),
  deserialize: <T>(bytes: Uint8Array): T => {
    const dataString = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(dataString) as T;
    } catch {
      return dataString as T;
    }
  },
});
