import {
  formatTaggedTemplate,
  getRuntimeEnv,
  isTemplateStringsArray,
  LOG_LEVELS,
  type Logger,
  resolveLogLevel,
} from './loggerShared';

const logLevel = resolveLogLevel('DEBUG');
const appName = getRuntimeEnv('APP_NAME') ?? 'deChat';

const write =
  (consoleMethod: 'debug' | 'info' | 'warn' | 'error', levelName: keyof typeof LOG_LEVELS) =>
  (message: TemplateStringsArray | unknown, ...args: unknown[]): void => {
    if (LOG_LEVELS[logLevel] > LOG_LEVELS[levelName]) return;
    const prefix = `[${appName}] ${levelName}`;
    if (isTemplateStringsArray(message)) {
      console[consoleMethod](prefix, formatTaggedTemplate(message, args));
      return;
    }
    console[consoleMethod](prefix, message, ...args);
  };

/**
 * Browser logger — console transport only.
 * No file streams, worker thread ids, or Node path resolution.
 */
export const logger: Logger = {
  silly: write('debug', 'SILLY'),
  trace: write('debug', 'TRACE'),
  debug: write('debug', 'DEBUG'),
  info: write('info', 'INFO'),
  warn: write('warn', 'WARN'),
  error: write('error', 'ERROR'),
  fatal: write('error', 'FATAL'),
};
