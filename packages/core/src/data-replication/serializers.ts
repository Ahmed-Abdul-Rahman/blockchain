import { DataSerializer } from './types';

export const canonicalSerialize = (value: unknown): Uint8Array => {
  const json = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  return new TextEncoder().encode(json);
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
