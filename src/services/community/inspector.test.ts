import { describe, expect, it } from 'vitest';
import { inspectableUrl, isPrivateAddress } from './inspector';

describe('what the inspector is allowed to open', () => {
  it('refuses private, loopback, link-local and internal addresses in every spelling', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '172.16.3.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'api.railway.internal', 'printer.local', 'metadata.google.internal', '2130706433', '0x7f000001']) {
      expect(isPrivateAddress(host), host).toBe(true);
    }
  });
  it('accepts public hosts', () => {
    for (const host of ['coden.fun', 'my-app.vercel.app', '8.8.8.8', '172.32.0.1']) expect(isPrivateAddress(host), host).toBe(false);
  });
  it('opens only https addresses without credentials', () => {
    expect(inspectableUrl('https://my-app.vercel.app/')?.hostname).toBe('my-app.vercel.app');
    expect(inspectableUrl('http://my-app.vercel.app/')).toBeNull();
    expect(inspectableUrl('https://user:pw@my-app.vercel.app/')).toBeNull();
    expect(inspectableUrl('https://169.254.169.254/latest/meta-data')).toBeNull();
    expect(inspectableUrl('file:///etc/passwd')).toBeNull();
    expect(inspectableUrl('not a url')).toBeNull();
  });
});
