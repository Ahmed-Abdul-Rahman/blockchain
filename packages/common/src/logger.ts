import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { threadId } from 'worker_threads';
import { createStream } from 'rotating-file-stream';
import { Logger } from 'tslog';

const logLevels = {
  SILLY: 0,
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
};
// Log file directory
const __filename = fileURLToPath(import.meta.url);
const logDirectory = path.join(dirname(__filename), 'logs');

let logLevel = 'TRACE';

if (process.env.NODE_ENV === 'production') logLevel = 'INFO';
else if (process.env.NODE_ENV === 'perf') logLevel = 'INFO';

if (process.env.LOG_LEVEL) logLevel = process.env.LOG_LEVEL;

const baseLogger = new Logger({
  name: process.env.APP_NAME ?? 'deChat',
  minLevel: logLevels[logLevel],
  type: process.env.NODE_ENV === 'production' ? 'json' : 'pretty',
  hideLogPositionForProduction: true,
  prettyLogTemplate: '{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}.{{ms}} {{logLevelName}} {{name}}: ',
  prettyLogTimeZone: 'UTC', // or "UTC"
});

// Console + Rotating File
if (process.env.NODE_ENV === 'production') {
  // Create rotating stream: rotate daily, keep 7 days
  const logStream = createStream('deChat.log', {
    interval: '1d', // rotate daily
    maxFiles: 7, // keep last 7 log files
    path: logDirectory,
    compress: 'gzip', // compress old logs
  });

  baseLogger.attachTransport((logObj) => {
    logStream.write(JSON.stringify(logObj) + '\n');
  });
}

const tag = (parts, ...substitutions): string => {
  let result = parts[0];
  substitutions.forEach((obj, i) => {
    result += obj + parts[i + 1];
  });
  if (process.env.NODE_ENV === 'perf') return threadId + ' ' + result;
  return result;
};

const prefixMessage = process.env.NODE_ENV === 'perf' ? threadId + ' ' : '';

const isTemplateStringsArray = (x: unknown): x is TemplateStringsArray =>
  Array.isArray(x) && Object.prototype.hasOwnProperty.call(x, 'raw');

export const logger = {
  // Tagged template support
  silly(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (logLevels[logLevel] > 0) return;
    if (isTemplateStringsArray(message)) {
      baseLogger.silly(tag(message, ...args));
      return;
    }
    baseLogger.silly(prefixMessage, message, ...args);
  },

  trace(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (logLevels[logLevel] > 1) return;
    if (isTemplateStringsArray(message)) {
      baseLogger.trace(tag(message, ...args));
      return;
    }
    baseLogger.trace(prefixMessage, message, ...args);
  },

  debug(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (logLevels[logLevel] > 2) return;
    if (isTemplateStringsArray(message)) {
      baseLogger.debug(tag(message, ...args));
      return;
    }
    baseLogger.debug(prefixMessage, message, ...args);
  },

  info(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (logLevels[logLevel] > 3) return;
    if (isTemplateStringsArray(message)) {
      baseLogger.info(tag(message, ...args));
      return;
    }
    baseLogger.info(prefixMessage, message, ...args);
  },

  warn(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (logLevels[logLevel] > 4) return;
    if (isTemplateStringsArray(message)) {
      baseLogger.warn(tag(message, ...args));
      return;
    }
    baseLogger.warn(prefixMessage, message, ...args);
  },

  error(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (logLevels[logLevel] > 5) return;
    if (isTemplateStringsArray(message)) {
      baseLogger.error(tag(message, ...args));
      return;
    }
    baseLogger.error(prefixMessage, message, ...args);
  },

  fatal(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (logLevels[logLevel] > 6) return;
    if (isTemplateStringsArray(message)) {
      baseLogger.fatal(tag(message, ...args));
      return;
    }
    baseLogger.fatal(prefixMessage, message, ...args);
  },
  // You can add more levels (trace, fatal...) as needed
};
