import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@core': path.resolve(__dirname, '../src/clinical') }
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3000', '/verify': 'http://localhost:3000' }
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 }
});
