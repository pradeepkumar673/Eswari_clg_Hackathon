import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tmp/**', '.data/**'],
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0',
      NODE_ENV: 'test',
    },
  },
});
