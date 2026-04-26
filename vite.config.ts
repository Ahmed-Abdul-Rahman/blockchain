import { resolve } from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8', // Uses the native V8 engine for fast coverage
      reporter: ['text', 'html', 'lcov'], // 'text' for terminal, 'html' for browser, 'lcov' for CI
      include: ['src/**/*.ts'], // Only track source files
      exclude: [
        'src/metrics/noop/**', // Exclude dummy metric implementations
        '**/*.d.ts', // Exclude type definitions
        'tests/**', // Exclude the test files themselves
      ],
      // Optional: enforce coverage thresholds to fail the build if coverage drops
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  cacheDir: resolve(__dirname, './node_modules/.vitest'),
});
