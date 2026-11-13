import { networkInterfaces } from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: { host: true, port: PORT, strictPort: true },
  define: { __LAN_ORIGIN__: JSON.stringify(command === 'serve' ? lanOrigin() : null) },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
}));
