import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { threadId } from 'node:worker_threads';
import { createStream } from 'rotating-file-stream';
import { Logger as TsLogger } from 'tslog';
import {
  formatTaggedTemplate,
  getRuntimeEnv,
  isTemplateStringsArray,
  LOG_LEVELS,
  type Logger,
  resolveLogLevel,
} from './loggerShared';

const __filename = fileURLToPath(import.meta.url);
const logDirectory = path.join(dirname(__filename), 'logs');

const logLevel = resolveLogLevel('TRACE');
const nodeEnv = getRuntimeEnv('NODE_ENV');

const baseLogger = new TsLogger({
  name: getRuntimeEnv('APP_NAME') ?? 'deChat',
  minLevel: LOG_LEVELS[logLevel],
  type: nodeEnv === 'production' ? 'json' : 'pretty',
  hideLogPositionForProduction: true,
  prettyLogTemplate: '{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}.{{ms}} {{logLevelName}} {{name}}: ',
  prettyLogTimeZone: 'UTC',
});

if (nodeEnv === 'production') {
  const logStream = createStream('deChat.log', {
    interval: '1d',
    maxFiles: 7,
    path: logDirectory,
    compress: 'gzip',
  });

  baseLogger.attachTransport((logObj) => {
    logStream.write(JSON.stringify(logObj) + '\n');
  });
}

const tag = (parts: TemplateStringsArray, ...substitutions: unknown[]): string => {
  const result = formatTaggedTemplate(parts, substitutions);
  if (nodeEnv === 'perf') return `${threadId} ${result}`;
  return result;
};

const prefixMessage = nodeEnv === 'perf' ? `${threadId} ` : '';

const createLevelMethod =
  (levelName: keyof typeof LOG_LEVELS, write: (...args: unknown[]) => void) =>
  (message: TemplateStringsArray | unknown, ...args: unknown[]): void => {
    if (LOG_LEVELS[logLevel] > LOG_LEVELS[levelName]) return;
    if (isTemplateStringsArray(message)) {
      write(tag(message, ...args));
      return;
    }
    write(prefixMessage, message, ...args);
  };

/** Node logger — tslog + optional rotating file transport in production. */
export const logger: Logger = {
  silly: createLevelMethod('SILLY', (...a) => baseLogger.silly(...a)),
  trace: createLevelMethod('TRACE', (...a) => baseLogger.trace(...a)),
  debug: createLevelMethod('DEBUG', (...a) => baseLogger.debug(...a)),
  info: createLevelMethod('INFO', (...a) => baseLogger.info(...a)),
  warn: createLevelMethod('WARN', (...a) => baseLogger.warn(...a)),
  error: createLevelMethod('ERROR', (...a) => baseLogger.error(...a)),
  fatal: createLevelMethod('FATAL', (...a) => baseLogger.fatal(...a)),
};
