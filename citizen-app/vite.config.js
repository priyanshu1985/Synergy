import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // lets you test offline behaviour with `npm run dev`, not just after a build
      devOptions: { enabled: true },
      manifest: {
        name: 'Raahat — Flood Help Request',
        short_name: 'Raahat',
        description: 'Send your location to rescue teams, even with no signal.',
        theme_color: '#0F1B2B',
        background_color: '#EEF1EF',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // precache every built asset (JS/CSS/HTML) — this is what makes the app
        // OPEN with zero signal, same job the hand-rolled service worker did before
        globPatterns: ['**/*.{js,css,html,png,svg,ico}']
      }
    })
  ]
});
