import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// App metadata — single source of truth for manifest + meta tags
const APP_NAME = 'Check Yo Self';
const APP_SHORT_NAME = 'CYS';
const APP_DESCRIPTION =
  'Budget tracking powered by YNAB. See your spending pace and cashflow at a glance.';
const THEME_COLOR = '#0f172a';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Local-only: trusted HTTPS via mkcert (skip in CI where certs aren't available)
    ...(!process.env.CI ? [mkcert()] : []),
    {
      name: 'inject-meta',
      transformIndexHtml(html) {
        return html
          .replace('%APP_DESCRIPTION%', APP_DESCRIPTION)
          .replace('%THEME_COLOR%', THEME_COLOR);
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        theme_color: THEME_COLOR,
        background_color: THEME_COLOR,
        display: 'standalone',
        scope: '/check-yo-self/',
        start_url: '/check-yo-self/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
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
  build: {
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
