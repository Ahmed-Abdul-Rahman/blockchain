import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createStream } from 'rotating-file-stream';
import { Logger } from 'tslog';

const logLevels = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};
// Log file directory
const __filename = fileURLToPath(import.meta.url);
const logDirectory = path.join(dirname(__filename), 'logs');

const baseLogger = new Logger({
  name: 'app',
  minLevel: process.env.NODE_ENV === 'production' ? logLevels.info : logLevels.debug,
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
  return result;
};

const isTemplateStringsArray = (x: unknown): x is TemplateStringsArray =>
  Array.isArray(x) && Object.prototype.hasOwnProperty.call(x, 'raw');

const logger = {
  // Tagged template support
  silly(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (isTemplateStringsArray(message)) {
      baseLogger.silly(tag(message, ...args));
      return;
    }
    baseLogger.silly(message, ...args);
  },

  trace(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (isTemplateStringsArray(message)) {
      baseLogger.trace(tag(message, ...args));
      return;
    }
    baseLogger.trace(message, ...args);
  },

  debug(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (isTemplateStringsArray(message)) {
      baseLogger.debug(tag(message, ...args));
      return;
    }
    baseLogger.debug(message, ...args);
  },

  info(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (isTemplateStringsArray(message)) {
      baseLogger.info(tag(message, ...args));
      return;
    }
    baseLogger.info(message, ...args);
  },

  warn(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (isTemplateStringsArray(message)) {
      baseLogger.warn(tag(message, ...args));
      return;
    }
    baseLogger.warn(message, ...args);
  },

  error(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (isTemplateStringsArray(message)) {
      baseLogger.error(tag(message, ...args));
      return;
    }
    baseLogger.error(message, ...args);
  },

  fatal(message: TemplateStringsArray | unknown, ...args: unknown[]): void {
    if (isTemplateStringsArray(message)) {
      baseLogger.fatal(tag(message, ...args));
      return;
    }
    baseLogger.fatal(message, ...args);
  },
  // You can add more levels (trace, fatal...) as needed
};

export default logger;
