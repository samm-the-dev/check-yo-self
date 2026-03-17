import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Local-only: trusted HTTPS via mkcert (skip in CI where certs aren't available)
    ...(!process.env.CI ? [mkcert()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Check Yo Self',
        short_name: 'CheckYoSelf',
        description: 'Daily budgeting -- know what you can spend today.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        scope: '/check-yo-self/',
        start_url: '/check-yo-self/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  base: command === 'build' ? '/check-yo-self/' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
  },
}));
