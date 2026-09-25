import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => ({
  root: 'apps/dashboard', plugins: [react(), {
    name: 'license-notices',
    async closeBundle() {
      const output = mode === 'fixture' ? 'dist/dashboard-demo' : 'dist/dashboard';
      for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await copyFile(resolve(file), resolve(output, file));
    }
  }],
  server: { host: '127.0.0.1', port: 3000, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3002', '/auth': 'http://127.0.0.1:3002' } },
  build: { outDir: mode === 'fixture' ? '../../dist/dashboard-demo' : '../../dist/dashboard', emptyOutDir: true }
}));
