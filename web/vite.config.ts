import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // 本地开发时 /v1 走线上 Worker；主题工坊的奶龙示例读仓库里的 packages/
  server: { proxy: { '/v1': { target: 'https://enso-plugins.j3.do', changeOrigin: true } }, fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), studio: path.resolve(__dirname, 'studio/index.html') } },
  },
});
