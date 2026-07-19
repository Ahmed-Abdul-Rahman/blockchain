/**
 * Default (Node) logger re-export so existing `./logger` imports keep working.
 * Bundlers that honor the package `browser` condition resolve `../browser.ts` instead.
 */
export { logger } from './logger.node';
