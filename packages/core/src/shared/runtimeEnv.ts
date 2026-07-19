/**
 * Safe environment lookup for isomorphic core code.
 * Avoids direct `process.env` access that breaks browser bundles without a Node polyfill.
 */
export const getRuntimeEnv = (name: string): string | undefined => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
};

/** True when running under a production-like Node env flag. */
export const isProductionRuntime = (): boolean => getRuntimeEnv('NODE_ENV') === 'production';
