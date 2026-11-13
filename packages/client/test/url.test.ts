import { describe, expect, it } from 'vitest';
import { defaultServerUrl, inviteLink } from '../src/net/url';

describe('urls', () => {
  it('uses ws on http pages and wss on https pages', () => {
    expect(defaultServerUrl({ protocol: 'http:', hostname: '192.168.1.161' })).toBe('ws://192.168.1.161:8787');
    expect(defaultServerUrl({ protocol: 'https:', hostname: 'play.example.org' })).toBe('wss://play.example.org:8787');
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
