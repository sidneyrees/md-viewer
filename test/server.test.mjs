import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createViewerServer } from '../src/server.mjs';

const rendererDir = path.join(import.meta.dirname, '..', 'src', 'renderer');
let dir;
let viewer;

const api = (p, init) => fetch(viewer.url + p, init);
const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const q = (p) => encodeURIComponent(p);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.md'), '# Hola\n\nTexto Ñandú\n');
  fs.writeFileSync(path.join(dir, 'sub', 'b.MD'), '# B\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'no es markdown');
  fs.writeFileSync(path.join(dir, 'foomd'), 'termina en md pero no es .md');
  viewer = await createViewerServer({ rendererDir, root: dir });
});

after(async () => {
  await viewer.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lists only .md files, nested and case-insensitive', async () => {
  const { tree } = await (await api('/api/tree')).json();
  const names = JSON.stringify(tree);
  assert.match(names, /a\.md/);
  assert.match(names, /b\.MD/);
  assert.doesNotMatch(names, /notes\.txt|foomd/);
});

test('reads a file and refuses non-markdown files', async () => {
  const ok = await (await api('/api/file?path=' + q('a.md'))).json();
  assert.match(ok.content, /Hola/);
  assert.equal((await api('/api/file?path=' + q('notes.txt'))).status, 404);
  assert.equal((await api('/api/file?path=' + q('foomd'))).status, 404);
});

test('refuses paths outside the working folder', async () => {
  assert.equal((await api('/api/file?path=' + q('../outside.md'))).status, 404);
  const res = await api('/api/file?path=' + q('../outside.md'), json('POST', {}));
  assert.equal(res.status, 400);
  assert.equal((await api('/raw/' + q('../../etc/passwd'))).status, 404);
});

test('creates, edits, renames and deletes a file without overwriting', async () => {
  assert.equal((await api('/api/file?path=' + q('new/n.md'), { method: 'POST' })).status, 200);
  assert.equal((await api('/api/file?path=' + q('new/n.md'), { method: 'POST' })).status, 409);

  const put = await api('/api/file?path=' + q('new/n.md'), json('PUT', { content: '# editado\n' }));
  assert.equal(put.status, 200);
  assert.equal(fs.readFileSync(path.join(dir, 'new', 'n.md'), 'utf8'), '# editado\n');

  const clash = await api('/api/file?path=' + q('new/n.md'), json('PATCH', { to: 'a.md' }));
  assert.equal(clash.status, 409);
  const moved = await api('/api/file?path=' + q('new/n.md'), json('PATCH', { to: 'moved/m.md' }));
  assert.equal(moved.status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'moved', 'm.md')));

  assert.equal((await api('/api/file?path=' + q('moved/m.md'), { method: 'DELETE' })).status, 200);
  assert.ok(!fs.existsSync(path.join(dir, 'moved', 'm.md')));
});

test('searches names and contents', async () => {
  const { results } = await (await api('/api/search?q=' + q('ñandú'))).json();
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'a.md');
  assert.equal(results[0].hits[0].line, 3);
});

test('switches the working folder and rejects invalid ones', async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-other-'));
  fs.writeFileSync(path.join(other, 'z.md'), '# Z\n');
  assert.equal((await api('/api/root', json('POST', { path: other }))).status, 200);
  assert.match(JSON.stringify((await (await api('/api/tree')).json()).tree), /z\.md/);
  assert.equal((await api('/api/root', json('POST', { path: path.join(other, 'nope') }))).status, 400);
  viewer.setRoot(dir);
  fs.rmSync(other, { recursive: true, force: true });
});

test('rejects foreign Host and Origin headers', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: viewer.port, path: '/api/tree', headers: { Host: 'evil.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
  const cross = await api('/api/tree', { headers: { Origin: 'http://evil.example' } });
  assert.equal(cross.status, 403);
});

test('serves only the known renderer files', async () => {
  assert.equal((await api('/')).status, 200);
  assert.equal((await api('/app.js')).status, 200);
  assert.equal((await api('/vendor/mermaid.min.js')).status, 200);
  assert.equal((await api('/package.json')).status, 404);
  assert.equal((await api('/vendor/..%2f..%2fpackage.json')).status, 404);
});
