import { networkInterfaces } from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const PORT = 5173;

/** First private IPv4 address of this computer, so invite links work for phones on the same Wi-Fi. */
function lanOrigin(): string | null {
  const addrs = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
  const ip = addrs.find((a) => a.startsWith('192.168.')) ?? addrs.find((a) => a.startsWith('10.')) ?? null;
  return ip ? `http://${ip}:${PORT}` : null;
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: { host: true, port: PORT, strictPort: true },
  define: { __LAN_ORIGIN__: JSON.stringify(command === 'serve' ? lanOrigin() : null) },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
}));
