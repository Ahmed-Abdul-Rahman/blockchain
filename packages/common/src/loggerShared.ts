/**
 * Shared logger surface used by Node and browser adapters.
 * Implementations differ only in transports / env resolution.
 */

export const LOG_LEVELS = {
  SILLY: 0,
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
} as const;

export type LogLevelName = keyof typeof LOG_LEVELS;

export interface Logger {
  silly(message: TemplateStringsArray | unknown, ...args: unknown[]): void;
  trace(message: TemplateStringsArray | unknown, ...args: unknown[]): void;
  debug(message: TemplateStringsArray | unknown, ...args: unknown[]): void;
  info(message: TemplateStringsArray | unknown, ...args: unknown[]): void;
  warn(message: TemplateStringsArray | unknown, ...args: unknown[]): void;
  error(message: TemplateStringsArray | unknown, ...args: unknown[]): void;
  fatal(message: TemplateStringsArray | unknown, ...args: unknown[]): void;
}

/** Safe env lookup — never throws when `process` is absent (browser). */
export const getRuntimeEnv = (name: string): string | undefined => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
};

export const resolveLogLevel = (fallback: LogLevelName = 'TRACE'): LogLevelName => {
  const nodeEnv = getRuntimeEnv('NODE_ENV');
  let level: string = fallback;
  if (nodeEnv === 'production' || nodeEnv === 'perf') level = 'INFO';
  const override = getRuntimeEnv('LOG_LEVEL');
  if (override) level = override;
  return (level in LOG_LEVELS ? level : fallback) as LogLevelName;
};

export const isTemplateStringsArray = (x: unknown): x is TemplateStringsArray =>
  Array.isArray(x) && Object.prototype.hasOwnProperty.call(x, 'raw');

export const formatTaggedTemplate = (parts: TemplateStringsArray, substitutions: unknown[]): string => {
  let result = parts[0] ?? '';
  substitutions.forEach((obj, i) => {
    result += String(obj) + (parts[i + 1] ?? '');
  });
  return result;
};
