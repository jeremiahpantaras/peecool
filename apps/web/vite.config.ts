import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const target = process.env.PICKLE_SERVER ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, host: true, proxy: { '/api': target, '/socket.io': { target, ws: true } } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
