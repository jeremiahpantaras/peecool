import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, seedEnv, type TestEnv } from './helpers';
import { clearSeenDevices } from '../src/lib/seenDevices';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(2)); });
afterAll(async () => { await env.destroy(); });

describe('connecting a phone', () => {
  it('Admin and Staff can both get the address and QR code; a stranger cannot; system details stay Admin-only', async () => {
    for (const who of [admin, staff]) {
      const own = env.ctx.config.port;                              // the server's own port: this is how a production install is opened
      const r = await who.get('system/connect', { host: `192.168.1.5:${own}` });
      expect(r.status).toBe(200);
      expect(r.body.primaryUrl).toBe(`http://192.168.1.5:${own}`);
      expect(r.body.qrSvg).toContain('<svg');
      expect(r.body.viaDevServer).toBe(false);
      expect(Object.keys(r.body)).not.toContain('dataDir');       // nothing about the machine, only what a phone needs
    }
    expect((await new Client(env).get('system/connect')).status).toBe(401);
    expect((await staff.get('system/info')).status).toBe(403);
    expect((await admin.get('system/info')).body.dataDir).toBeTruthy();
  });

  it('the address a browser is already using is offered first (a staff phone can show the QR to another phone); localhost falls back to this PC', async () => {
    const lan = await staff.get('system/connect', { host: '10.20.30.40:5173' });
    expect(lan.body.primaryUrl).toBe('http://10.20.30.40:5173');
    expect(lan.body.lanUrls[0]).toBe('http://10.20.30.40:5173');
    expect(lan.body.viaDevServer).toBe(true);
    const local = await staff.get('system/connect', { host: 'localhost:8080' });
    expect(local.body.primaryUrl).not.toContain('localhost');   // never hand a phone "localhost" when this PC has a network address
    const noNet = local.body.lanUrls.length === 0;
    if (noNet) expect(local.body.primaryUrl).toBe('http://localhost:8080');   // a PC with no network: say so, do not invent an address
    expect(local.body.lanUrls.every((u: string) => !u.includes('169.254.'))).toBe(true);
  });

  it('the address and QR code use the port the browser used (the dev server is :5173, the API is :8080)', async () => {
    const viaVite = await admin.get('system/info', { host: '192.168.1.5:5173' });
    expect(viaVite.status).toBe(200);
    expect(viaVite.body.lanUrls.every((u: string) => u.endsWith(':5173'))).toBe(true);
    expect(viaVite.body.primaryUrl.endsWith(':5173')).toBe(true);
    const direct = await admin.get('system/info', { host: 'localhost:8080' });
    expect(direct.body.primaryUrl.endsWith(':8080')).toBe(true);
    expect((await admin.get('system/info', { host: 'peecool.local' })).body.primaryUrl).toMatch(/:\d+$/); // no port in Host: falls back to the server's own port
  });

  it('a server without a built web app explains itself instead of answering a bare 404', async () => {
    if (env.ctx.config.webRoot) return;                        // only meaningful when no web app is bundled (the normal test setup)
    const page = await admin.get('/', { accept: 'text/html', host: '192.168.1.5:8080' });
    expect(page.status).toBe(200);
    expect(page.raw).toContain('Peecool server is running');
    expect(page.raw).toContain('http://192.168.1.5:5173');     // tells you where the app is in development
    expect((await admin.get('/api/v1/nope')).status).toBe(404); // the API still answers 404 JSON
  });

  it('shows which other devices have reached this computer, so staff can tell whether the phone got through', async () => {
    clearSeenDevices();
    const none = await staff.get('system/connect');
    expect(none.body.devices.filter((d: { you: boolean }) => !d.you)).toEqual([]);   // nobody else yet (the viewer's own request shows as "you")
    // a phone opens the address: even the login page's request counts, and its model is read from the browser
    const phone = new Client(env, '192.168.1.23');
    await phone.get('system/connect', { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
    const tablet = new Client(env, '::ffff:192.168.1.40');
    await tablet.get('system/connect', { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36' });
    const seen = (await admin.get('system/connect')).body.devices as { ip: string; kind: string; you: boolean; requests: number }[];
    expect(seen.find((d) => d.ip === '192.168.1.23')).toMatchObject({ kind: 'iPhone', you: false, requests: 1 });
    expect(seen.find((d) => d.ip === '192.168.1.40')).toMatchObject({ kind: 'Android tablet' });   // IPv4-in-IPv6 form is normalised
    expect(seen.find((d) => d.ip === '10.0.0.31')).toMatchObject({ you: false });   // Staff's own LAN address, as seen by the Admin (who is on the server itself)
    expect(((await staff.get('system/connect')).body.devices as { ip: string; you: boolean }[]).find((d) => d.you)).toMatchObject({ ip: '10.0.0.31' });
    // this computer itself is never listed
    await new Client(env, '127.0.0.1').get('system/connect');
    expect((await admin.get('system/connect')).body.devices.some((d: { ip: string }) => d.ip.startsWith('127.'))).toBe(false);
    // behind the dev proxy the real address arrives in X-Forwarded-For, and is believed only from the local proxy
    await new Client(env, '127.0.0.1').get('system/connect', { 'x-forwarded-for': '192.168.1.77', 'user-agent': 'Mozilla/5.0 (iPhone) Safari' });
    await new Client(env, '10.9.9.9').get('system/connect', { 'x-forwarded-for': '192.168.1.99' });          // a LAN device cannot pose as another
    const after = (await admin.get('system/connect')).body.devices.map((d: { ip: string }) => d.ip);
    expect(after).toContain('192.168.1.77'); expect(after).not.toContain('192.168.1.99'); expect(after).toContain('10.9.9.9');
  });
});
