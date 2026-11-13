import { networkInterfaces } from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const PORT = 5173;
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|docker|wsl|loopback|bluetooth/i;

/**
 * This computer's Wi-Fi address, so invite links work for phones on the same network.
 * Prefers the Wi-Fi adapter and skips virtual ones (VirtualBox uses 192.168.56.x). LAN_HOST overrides it.
 */
function lanOrigin(): string | null {
  if (process.env.LAN_HOST) return `http://${process.env.LAN_HOST}:${PORT}`;
  const found = Object.entries(networkInterfaces()).flatMap(([name, addrs]) =>
    (addrs ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, ip: a.address })),
  );
  const real = found.filter((x) => !VIRTUAL.test(x.name) && !x.ip.startsWith('192.168.56.') && !x.ip.startsWith('169.254.'));
  const pick =
    real.find((x) => /wi-?fi|wlan|wireless|en0/i.test(x.name)) ?? real.find((x) => /^(192\.168|10)\./.test(x.ip)) ?? real[0];
  return pick ? `http://${pick.ip}:${PORT}` : null;
}

/** The installed-app shell: manifest, icons and a Workbox service worker that precaches the built files. */
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: false,
  includeAssets: ['icon.svg', 'apple-touch-icon.png'],
  manifest: {
    id: '/',
    name: 'Arcane Academies',
    short_name: 'Academies',
    description: 'Rival schools of magic. One phone each.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#17112e',
    theme_color: '#17112e',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
    navigateFallback: '/index.html',
    // The health check and anything that is not the app must always reach the server.
    navigateFallbackDenylist: [/^\/health/],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'google-fonts-css' },
      },
      {
        urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
        handler: 'CacheFirst',
        options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
      },
    ],
  },
});

export default defineConfig(({ command }) => ({
  plugins: [react(), pwa],
  server: { host: true, port: PORT, strictPort: true },
  define: { __LAN_ORIGIN__: JSON.stringify(command === 'serve' ? lanOrigin() : null) },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
}));
