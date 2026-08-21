import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: '**/*.pw.ts',
  timeout: 90_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
  },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
});
