import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0',
      NODE_ENV: 'test'
    }
  }
});

