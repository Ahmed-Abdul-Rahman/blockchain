import { afterEach, describe, expect, it, vi } from 'vitest';

describe('browser logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('writes info/warn/error to console and respects LOG_LEVEL', async () => {
    vi.stubGlobal('process', { env: { LOG_LEVEL: 'WARN', APP_NAME: 'test-app' } });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { logger } = await import('./logger.browser');
    logger.info('hidden');
    logger.warn('visible-warn');
    logger.error('visible-error');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
