import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // Los tests comparten la misma base de datos: se ejecutan de a uno.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
