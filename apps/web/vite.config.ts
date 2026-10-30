import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('[vite-proxy] API unreachable:', (err as any).code, err.message);
          });
        }
      },
      '/ws': {
        target: 'ws://127.0.0.1:4000',
        ws: true
      }
    }
  }
});

