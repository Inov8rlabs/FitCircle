import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: 'node',
    include: ['app/lib/engage/__tests__/*.test.{ts,tsx}'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './app') } },
});
