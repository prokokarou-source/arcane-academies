import { describe, expect, it } from 'vitest';
import { defaultServerUrl, healthUrl, inviteLink } from '../src/net/url';

describe('urls', () => {
  it('in development talks to the server on port 8787 next to the page', () => {
    expect(defaultServerUrl({ protocol: 'http:', hostname: '192.168.1.161', host: '192.168.1.161:5173' }, true)).toBe('ws://192.168.1.161:8787');
  });

  it('when deployed talks to the address the page came from, with wss on https', () => {
    expect(defaultServerUrl({ protocol: 'https:', hostname: 'arcane.onrender.com', host: 'arcane.onrender.com' }, false)).toBe('wss://arcane.onrender.com');
    expect(defaultServerUrl({ protocol: 'http:', hostname: 'localhost', host: 'localhost:8787' }, false)).toBe('ws://localhost:8787');
  });

  it('invite links use the Wi-Fi address when the page was opened as localhost', () => {
    const local = { origin: 'http://localhost:5173', hostname: 'localhost' };
    expect(inviteLink('WAND-42', local, 'http://192.168.1.161:5173')).toBe('http://192.168.1.161:5173/?room=WAND-42');
    expect(inviteLink('WAND-42', local, null)).toBe('http://localhost:5173/?room=WAND-42');
    expect(inviteLink('WAND-42', { origin: 'http://192.168.1.161:5173', hostname: '192.168.1.161' }, 'http://10.0.0.2:5173')).toBe(
      'http://192.168.1.161:5173/?room=WAND-42',
    );
  });
});

describe('healthUrl', () => {
  it('turns the socket address into the HTTP health check', () => {
    expect(healthUrl('wss://arcane.example.com')).toBe('https://arcane.example.com/health');
    expect(healthUrl('ws://192.168.1.5:8787')).toBe('http://192.168.1.5:8787/health');
  });
});
