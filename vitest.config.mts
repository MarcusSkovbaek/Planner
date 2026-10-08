import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Run in the users' time zone on every machine, so daylight saving time is covered (CI runs in UTC).
process.env.TZ = 'Europe/Copenhagen';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
