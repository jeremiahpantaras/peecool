import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type RunningServer } from '../src/server';

let srv: RunningServer; let dir: string; let web: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-static-')); web = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-web-'));
  fs.mkdirSync(path.join(web, 'assets'));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>app</title><div id="root"></div>');
  fs.writeFileSync(path.join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(web, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  srv = await createServer({ config: { dataDir: dir, dbFile: path.join(dir, 'p.db'), fastHash: true, logLevel: 'silent', webRoot: web, port: 0, host: '127.0.0.1' } });
});
afterAll(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(web, { recursive: true, force: true }); });

describe('serving the web app (SYSTEM_ARCHITECTURE §3.7)', () => {
  const get = (url: string) => srv.app.inject({ method: 'GET', url, remoteAddress: '10.0.0.8' });
  it('serves index.html, hashed assets and icons to signed-out visitors', async () => {
    expect((await get('/')).statusCode).toBe(200);
    const js = await get('/assets/app-abc123.js');
    expect(js.statusCode).toBe(200); expect(js.headers['cache-control']).toContain('immutable'); expect(js.headers['content-type']).toContain('javascript');
    expect((await get('/icon.svg')).statusCode).toBe(200);
  });
  it('falls back to index.html for client-side routes but not for /api or missing assets paths of the API', async () => {
    const r = await get('/courts/3'); expect(r.statusCode).toBe(200); expect(r.body).toContain('id="root"');
    expect(r.headers['cache-control']).toBe('no-cache');
    const api = await get('/api/v1/nope'); expect(api.statusCode).toBe(404); expect(JSON.parse(api.body).error.code).toBe('NOT_FOUND');
    expect((await get('/api/v1/courts')).statusCode).toBe(401); // the API stays protected
  });
});
