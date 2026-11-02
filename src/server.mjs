// .MD Viewer local HTTP server: file API plus the renderer's static files.
// Shared by the desktop app (Electron) and the browser mode (`npm run web`).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const isMd = (p) => /\.md$/i.test(p);

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// Read a JSON request body (10 MB cap).
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/**
 * Start the viewer server.
 *
 * @param {object} options
 * @param {string} options.rendererDir Folder with index.html, app.js, styles.css and vendor/.
 * @param {string} [options.root] Working folder; defaults to the last one used, then `fallbackRoot`.
 * @param {string} [options.fallbackRoot] Folder used when nothing else is available.
 * @param {string} [options.configPath] JSON file that remembers the last folder.
 * @param {number} [options.port] First port to try; 0 picks a free one.
 * @param {number} [options.portRange] How many following ports to try when busy.
 * @returns {Promise<{url: string, port: number, getRoot: () => string, setRoot: (p: string) => boolean, close: () => Promise<void>}>}
 */
export function createViewerServer({
  rendererDir,
  root,
  fallbackRoot = os.homedir(),
  configPath,
  port = 0,
  portRange = 0,
}) {
  const remember = () => {
    if (!configPath) return;
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ last: ROOT }), 'utf8');
    } catch {
      // remembering the folder is optional
    }
  };

  function initialRoot() {
    if (root) {
      const given = path.resolve(root);
      if (!isDir(given)) throw new Error('Folder not found: ' + given);
      return given;
    }
    try {
      const last = JSON.parse(fs.readFileSync(configPath, 'utf8')).last;
      if (last && isDir(last)) return last;
    } catch {
      // no saved folder yet
    }
    return path.resolve(fallbackRoot);
  }

  let ROOT = initialRoot();

  // Resolve a relative path inside ROOT; null if it escapes.
  function safe(rel) {
    const full = path.resolve(ROOT, '.' + path.sep + rel);
    return full === ROOT || full.startsWith(ROOT + path.sep) ? full : null;
  }

  // Folder tree; only includes folders that contain .md files.
  function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const children = walk(full);
        if (children.length) out.push({ name: e.name, type: 'dir', children });
      } else if (isMd(e.name)) {
        out.push({
          name: e.name,
          type: 'file',
          path: path.relative(ROOT, full).split(path.sep).join('/'),
        });
      }
    }
    return out.sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name, 'en', { numeric: true })
        : a.type === 'dir'
          ? -1
          : 1,
    );
  }

  // Flat list of every .md file path under ROOT.
  function listFiles(nodes = walk(ROOT)) {
    return nodes.flatMap((n) => (n.type === 'dir' ? listFiles(n.children) : [n.path]));
  }

  // Full-text search: up to 3 matching lines per file, 100 files max.
  function search(query) {
    const q = query.toLowerCase();
    const out = [];
    for (const p of listFiles()) {
      const nameHit = p.toLowerCase().includes(q);
      const lines = fs.readFileSync(safe(p), 'utf8').split(/\r?\n/);
      const hits = [];
      lines.forEach((line, i) => {
        if (hits.length < 3 && line.toLowerCase().includes(q)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
        }
      });
      if (nameHit || hits.length) out.push({ path: p, nameHit, hits });
      if (out.length >= 100) break;
    }
    return out;
  }

  // Subfolders of an absolute path (drives on Windows when empty), for the browser-mode picker.
  function browse(p) {
    if (!p) {
      if (process.platform !== 'win32') p = path.parse(os.homedir()).root;
      else {
        const drives = [];
        for (let c = 65; c <= 90; c++) {
          const d = String.fromCharCode(c) + ':\\';
          if (isDir(d)) drives.push(d);
        }
        return { path: '', parent: null, dirs: drives };
      }
    }
    const dir = path.resolve(p);
    if (!isDir(dir)) return null;
    const dirs = [];
    let mdCount = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        dirs.push(e.name);
      else if (e.isFile() && isMd(e.name)) mdCount++;
    }
    dirs.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const up = path.dirname(dir);
    return {
      path: dir,
      parent: up === dir ? (process.platform === 'win32' ? '' : null) : up,
      dirs,
      mdCount,
    };
  }

  // Static renderer files: only the known names, never arbitrary paths.
  function serveStatic(res, pathname) {
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    const allowed =
      ['index.html', 'app.js', 'styles.css'].includes(name) ||
      (name.startsWith('vendor/') && !name.slice(7).includes('/'));
    const full = path.join(rendererDir, name);
    if (!allowed || !fs.existsSync(full)) return false;
    send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
    return true;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    const rel = url.searchParams.get('path') || '';
    const fail = (code, msg) => send(res, code, JSON.stringify({ error: msg }));
    const failBody = (err) => fail(400, String(err.message));

    // Only accept requests addressed to this server from its own page (blocks DNS rebinding / CSRF).
    const okHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');
    const origin = req.headers.origin;
    if (!okHost || (origin && new URL(origin).host !== req.headers.host)) {
      return fail(403, 'forbidden');
    }

    try {
      if (req.method === 'GET' && serveStatic(res, url.pathname)) return;

      if (url.pathname === '/api/tree') {
        return send(res, 200, JSON.stringify({ root: ROOT, tree: walk(ROOT) }));
      }
      if (url.pathname === '/api/browse') {
        const r = browse(rel);
        return r ? send(res, 200, JSON.stringify(r)) : fail(404, 'not found');
      }
      if (url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim();
        return send(res, 200, JSON.stringify({ results: q ? search(q) : [] }));
      }
      if (url.pathname === '/api/root' && req.method === 'POST') {
        return void readJson(req).then((b) => {
          const next = path.resolve(String(b.path || ''));
          if (!b.path || !isDir(next)) return fail(400, 'invalid folder');
          ROOT = next;
          remember();
          send(res, 200, JSON.stringify({ root: ROOT }));
        }, failBody);
      }
      if (url.pathname === '/api/file') {
        const full = safe(rel);
        const exists = full && isMd(full) && fs.existsSync(full);
        if (req.method === 'GET') {
          if (!exists) return fail(404, 'not found');
          return send(
            res,
            200,
            JSON.stringify({ path: rel, content: fs.readFileSync(full, 'utf8') }),
          );
        }
        if (req.method === 'POST') {
          // Create an empty .md (and missing folders); never overwrites.
          if (!full || !isMd(full)) return fail(400, 'invalid path (must end in .md)');
          if (fs.existsSync(full)) return fail(409, 'already exists');
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, '# ' + path.basename(full, path.extname(full)) + '\n', 'utf8');
          return send(res, 200, '{"ok":true}');
        }
        if (!exists) return fail(404, 'not found');
        if (req.method === 'PUT') {
          return void readJson(req).then((b) => {
            fs.writeFileSync(full, String(b.content ?? ''), 'utf8');
            send(res, 200, '{"ok":true}');
          }, failBody);
        }
        if (req.method === 'PATCH') {
          // Rename / move; never overwrites.
          return void readJson(req).then((b) => {
            const to = safe(String(b.to || ''));
            if (!to || !isMd(to)) return fail(400, 'invalid path (must end in .md)');
            if (fs.existsSync(to)) return fail(409, 'already exists');
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.renameSync(full, to);
            send(res, 200, '{"ok":true}');
          }, failBody);
        }
        if (req.method === 'DELETE') {
          fs.rmSync(full);
          return send(res, 200, '{"ok":true}');
        }
      }
      if (url.pathname.startsWith('/raw/')) {
        // Relative files (images) referenced from a .md
        const full = safe(decodeURIComponent(url.pathname.slice(5)));
        if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile())
          return send(res, 404, 'not found', 'text/plain');
        return send(
          res,
          200,
          fs.readFileSync(full),
          MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        );
      }
      fail(404, 'not found');
    } catch (err) {
      fail(500, String(err.message));
    }
  });

  return new Promise((resolve, reject) => {
    const attempt = (p) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && p !== 0 && p < port + portRange) return attempt(p + 1);
        reject(err);
      });
      server.listen(p, HOST, () => {
        const actual = server.address().port;
        resolve({
          url: `http://${HOST}:${actual}`,
          port: actual,
          getRoot: () => ROOT,
          setRoot: (p2) => {
            const next = path.resolve(p2);
            if (!isDir(next)) return false;
            ROOT = next;
            remember();
            return true;
          },
          close: () => new Promise((r) => server.close(() => r())),
        });
      });
    };
    attempt(port);
  });
}
