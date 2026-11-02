const $ = (id) => document.getElementById(id);
let current = null; // path of the open file
let original = ''; // content on disk
let editing = false;

const dirty = () => editing && $('editor').value !== original;
const setStatus = (t) => {
  $('status').textContent = t;
};

// ---------- Tree ----------
function renderNode(n, depth) {
  const el = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  row.style.paddingLeft = 8 + depth * 16 + 'px';
  row.innerHTML = `<span class="ico">${n.type === 'dir' ? '📁' : '📝'}</span><span class="name"></span>`;
  row.querySelector('.name').textContent = n.name;
  row.title = n.name;
  el.appendChild(row);
  if (n.type === 'dir') {
    const kids = document.createElement('div');
    kids.className = 'kids';
    n.children.forEach((c) => kids.appendChild(renderNode(c, depth + 1)));
    el.appendChild(kids);
    row.onclick = () => {
      el.classList.toggle('open');
      row.querySelector('.ico').textContent = el.classList.contains('open') ? '📂' : '📁';
    };
  } else {
    row.dataset.path = n.path;
    row.onclick = () => openFile(n.path);
  }
  return el;
}

async function loadTree() {
  const r = await (await fetch('/api/tree')).json();
  const t = $('tree');
  t.innerHTML = '';
  $('rootName').textContent = r.root.split(/[\\/]/).filter(Boolean).pop() || r.root;
  $('btnRoot').title = r.root + '\n(click to change folder)';
  if (!r.tree.length) {
    t.innerHTML = '<div class="noresults">This folder has no .md files.</div>';
    return;
  }
  r.tree.forEach((n) => t.appendChild(renderNode(n, 0)));
}

// ---------- Folder picker ----------
let pickCurrent = '';
const sep = (p) => (p.includes('\\') ? '\\' : '/');

async function pickBrowse(p) {
  const r = await fetch('/api/browse?path=' + encodeURIComponent(p));
  if (!r.ok) {
    $('pickInfo').textContent = 'Cannot open that path.';
    return;
  }
  const d = await r.json();
  pickCurrent = d.path;
  $('pickPath').value = d.path;
  $('pickUse').disabled = !d.path;
  $('pickInfo').textContent = d.path
    ? d.mdCount + ' .md file(s) in this folder'
    : 'Pick a drive';
  const list = $('pickList');
  list.innerHTML = '';
  const add = (label, target) => {
    const el = document.createElement('div');
    el.textContent = label;
    el.onclick = () => pickBrowse(target);
    list.appendChild(el);
  };
  if (d.parent !== null) add('⬆ ..', d.parent);
  d.dirs.forEach((name) => {
    const full = d.path ? d.path.replace(/[\\/]$/, '') + sep(d.path) + name : name;
    add('📁 ' + name, d.path ? full : name);
  });
}

// Switch the working folder on the server and reset the UI. Returns false if rejected.
async function switchRoot(path) {
  const r = await fetch('/api/root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) return false;
  stopEditing();
  current = null;
  original = '';
  $('search').value = '';
  $('title').textContent = 'Choose a file';
  document.title = '.MD Viewer';
  $('btnEdit').disabled = true;
  $('view').innerHTML = '<p class="empty">Choose a file from the tree on the left.</p>';
  $('toc').classList.remove('has');
  history.replaceState(null, '', location.pathname);
  setStatus('');
  await loadTree();
  return true;
}

$('btnRoot').onclick = async () => {
  if (dirty() && !confirm('You have unsaved changes. Discard them?')) return;
  // Desktop app: native folder dialog. Browser: built-in picker below.
  if (window.desktop) {
    const picked = await window.desktop.pickFolder();
    if (picked) await switchRoot(picked);
    return;
  }
  $('picker').showModal();
  const r = await (await fetch('/api/tree')).json();
  pickBrowse(r.root);
};
$('pickGo').onclick = () => pickBrowse($('pickPath').value.trim());
$('pickPath').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pickBrowse($('pickPath').value.trim());
});
$('pickCancel').onclick = () => $('picker').close();
$('pickUse').onclick = async () => {
  if (await switchRoot(pickCurrent)) $('picker').close();
  else $('pickInfo').textContent = 'Invalid folder.';
};

// In-page text prompt (window.prompt is not available in Electron).
function askText(title, value) {
  return new Promise((resolve) => {
    const dlg = $('ask');
    const input = $('askInput');
    $('askTitle').textContent = title;
    input.value = value;
    let result = null;
    const done = () => {
      dlg.removeEventListener('close', done);
      resolve(result);
    };
    dlg.addEventListener('close', done);
    $('askOk').onclick = () => {
      result = input.value;
      dlg.close();
    };
    $('askCancel').onclick = () => dlg.close();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') $('askOk').click();
    };
    dlg.showModal();
    input.focus();
    input.select();
  });
}

function markSelected(p) {
  document.querySelectorAll('.row.sel').forEach((r) => r.classList.remove('sel'));
  const row = [...document.querySelectorAll('.row[data-path]')].find(
    (r) => r.dataset.path === p,
  );
  if (!row) return;
  row.classList.add('sel');
  // open ancestor folders
  for (let a = row.parentElement; a && a.id !== 'tree'; a = a.parentElement) {
    if (a.classList.contains('kids')) {
      a.parentElement.classList.add('open');
      a.parentElement.querySelector(':scope > .row .ico').textContent = '📂';
    }
  }
  row.scrollIntoView({ block: 'nearest' });
}

// ---------- Render ----------
function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
function resolveRel(base, href) {
  const parts = base ? base.split('/') : [];
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function render(md, target) {
  // Sanitized: opened documents may come from anywhere.
  target.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: false }));
  const base = dirOf(current);
  target.querySelectorAll('img').forEach((img) => {
    const s = img.getAttribute('src');
    if (s && !/^([a-z]+:|\/\/|data:)/i.test(s))
      img.src =
        '/raw/' +
        resolveRel(base, decodeURIComponent(s)).split('/').map(encodeURIComponent).join('/');
  });
  target.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (/^([a-z]+:|\/\/)/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener';
      return;
    }
    const [file, hash] = href.split('#');
    if (!file && hash) {
      // in-page anchor
      a.onclick = (e) => {
        e.preventDefault();
        target.querySelector('#' + CSS.escape(hash))?.scrollIntoView();
      };
      return;
    }
    if (/\.md$/i.test(file)) {
      a.onclick = (e) => {
        e.preventDefault();
        openFile(resolveRel(base, decodeURIComponent(file)));
      };
    } else {
      a.target = '_blank';
      a.href =
        '/raw/' +
        resolveRel(base, decodeURIComponent(file))
          .split('/')
          .map(encodeURIComponent)
          .join('/');
    }
  });
  // unique ids for heading anchors
  const seen = {};
  target.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    const id = h.textContent
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-');
    h.id = seen[id] ? id + '-' + seen[id] : id;
    seen[id] = (seen[id] || 0) + 1;
  });
  if (target.id === 'view') buildToc();
  renderMermaid(target);
}

// ---------- Mermaid ----------
marked.use({
  renderer: {
    code(code, lang) {
      if ((lang || '').trim().toLowerCase() !== 'mermaid') return false;
      const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<pre class="mermaid">' + esc + '</pre>';
    },
  },
});
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const initMermaid = () =>
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: darkQuery.matches ? 'dark' : 'default',
  });
initMermaid();
darkQuery.addEventListener('change', initMermaid);

async function renderMermaid(target) {
  const nodes = [...target.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return;
  try {
    await mermaid.run({ nodes, suppressErrors: true });
  } catch {
    // invalid diagram while typing: keep the source text visible
  }
}

// ---------- Table of contents ----------
function buildToc() {
  const toc = $('toc');
  const heads = [...$('view').querySelectorAll('h1,h2,h3,h4')];
  toc.classList.toggle('has', heads.length > 1);
  toc.innerHTML = '<h2>On this page</h2>';
  const min = Math.min(...heads.map((h) => Number(h.tagName[1])));
  heads.forEach((h) => {
    const a = document.createElement('a');
    a.textContent = h.textContent;
    a.href = '#' + h.id;
    a.dataset.id = h.id;
    a.style.paddingLeft = 8 + (Number(h.tagName[1]) - min) * 12 + 'px';
    a.onclick = (e) => {
      e.preventDefault();
      h.scrollIntoView();
    };
    toc.appendChild(a);
  });
  updateToc();
}

function updateToc() {
  const heads = [...$('view').querySelectorAll('h1,h2,h3,h4')];
  const top = $('content').getBoundingClientRect().top + 24;
  let active = heads[0];
  for (const h of heads) {
    if (h.getBoundingClientRect().top <= top) active = h;
  }
  $('toc')
    .querySelectorAll('a')
    .forEach((a) => a.classList.toggle('on', !!active && a.dataset.id === active.id));
}
$('content').addEventListener('scroll', updateToc);

// ---------- Open / edit / save ----------
async function openFile(p) {
  if (p === current && !editing) return;
  if (dirty() && !confirm('You have unsaved changes. Discard them?')) return;
  const r = await fetch('/api/file?path=' + encodeURIComponent(p));
  if (!r.ok) {
    setStatus('Could not open ' + p);
    return;
  }
  const data = await r.json();
  current = p;
  original = data.content;
  stopEditing();
  $('title').textContent = p;
  document.title = p.split('/').pop() + ' — .MD Viewer';
  $('btnEdit').disabled = false;
  render(original, $('view'));
  $('content').scrollTop = 0;
  markSelected(p);
  setStatus('');
  history.replaceState(null, '', '#' + encodeURIComponent(p));
}

function startEditing() {
  editing = true;
  document.body.classList.add('editing');
  $('editor').value = original;
  render(original, $('preview'));
  $('btnEdit').style.display = 'none';
  $('btnSave').style.display = $('btnCancel').style.display = '';
  $('btnSave').disabled = true;
  $('editor').focus();
}

function stopEditing() {
  editing = false;
  document.body.classList.remove('editing');
  $('btnEdit').style.display = '';
  $('btnSave').style.display = $('btnCancel').style.display = 'none';
}

async function save() {
  if (!editing || !dirty()) return;
  const content = $('editor').value;
  const r = await fetch('/api/file?path=' + encodeURIComponent(current), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) {
    setStatus('Error saving');
    return;
  }
  original = content;
  $('btnSave').disabled = true;
  render(original, $('view'));
  setStatus('Saved ' + new Date().toLocaleTimeString());
}

$('btnEdit').onclick = startEditing;
$('btnSave').onclick = save;
$('btnCancel').onclick = () => {
  if (dirty() && !confirm('Discard your changes?')) return;
  stopEditing();
  setStatus('');
};

let t;
$('editor').addEventListener('input', () => {
  $('btnSave').disabled = !dirty();
  setStatus(dirty() ? 'Unsaved' : '');
  clearTimeout(t);
  t = setTimeout(() => render($('editor').value, $('preview')), 150);
});
$('editor').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const el = e.target,
      s = el.selectionStart;
    el.setRangeText('  ', s, el.selectionEnd, 'end');
    el.dispatchEvent(new Event('input'));
  }
});
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});
addEventListener('beforeunload', (e) => {
  if (dirty()) e.preventDefault();
});

// ---------- Panel resize ----------
$('resizer').onmousedown = (e) => {
  e.preventDefault();
  const move = (ev) => {
    $('side').style.width = Math.max(180, ev.clientX) + 'px';
  };
  const up = () => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
};

// ---------- Search ----------
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mark = (t, q) => {
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(t);
  return (
    esc(t.slice(0, i)) +
    '<mark>' +
    esc(t.slice(i, i + q.length)) +
    '</mark>' +
    esc(t.slice(i + q.length))
  );
};

let searchTimer;
let searchSeq = 0;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('search').value = '';
    runSearch();
  }
});

async function runSearch() {
  const q = $('search').value.trim();
  const t = $('tree');
  if (!q) return loadTree();
  const seq = ++searchSeq;
  const r = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
  if (seq !== searchSeq) return; // a newer query is already running
  t.innerHTML = '';
  if (!r.results.length) {
    t.innerHTML = '<div class="noresults">No results.</div>';
    return;
  }
  r.results.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'hit';
    el.innerHTML =
      '<div class="p">' +
      mark(h.path, q) +
      '</div>' +
      h.hits.map((x) => '<div class="s">' + mark(x.text, q) + '</div>').join('');
    el.onclick = () => openFile(h.path);
    t.appendChild(el);
  });
}

addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('search').focus();
    $('search').select();
  }
});

// ---------- File operations ----------
const withMd = (p) => (/\.md$/i.test(p) ? p : p + '.md');
const clean = (p) => p.trim().replace(/\\/g, '/').replace(/^\/+/, '');

async function api(method, p, body) {
  const r = await fetch('/api/file?path=' + encodeURIComponent(p), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).error || r.status;
    setStatus('Error: ' + msg);
    alert('Error: ' + msg);
  }
  return r.ok;
}

async function refresh() {
  if ($('search').value.trim()) await runSearch();
  else await loadTree();
  if (current) markSelected(current);
}

$('btnNew').onclick = async () => {
  if (dirty() && !confirm('You have unsaved changes. Discard them?')) return;
  const dir = current ? dirOf(current) : '';
  const input = await askText(
    'Path of the new file (relative to the root folder)',
    (dir ? dir + '/' : '') + 'new.md',
  );
  if (!input || !clean(input)) return;
  stopEditing();
  const p = withMd(clean(input));
  if (await api('POST', p)) {
    current = null;
    await refresh();
    await openFile(p);
    startEditing();
  }
};

// Context menu on files: rename / delete
let menuPath = null;
const menu = $('menu');
const hideMenu = () => {
  menu.style.display = 'none';
};
addEventListener('click', hideMenu);
addEventListener('blur', hideMenu);
$('tree').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row[data-path]');
  if (!row) return;
  e.preventDefault();
  menuPath = row.dataset.path;
  menu.style.left = Math.min(e.clientX, innerWidth - 160) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - 80) + 'px';
  menu.style.display = 'block';
});

$('mRename').onclick = async () => {
  const from = menuPath;
  if (from === current && dirty() && !confirm('You have unsaved changes. Discard them?'))
    return;
  const input = await askText('New path', from);
  if (!input || !clean(input)) return;
  if (from === current) stopEditing();
  const to = withMd(clean(input));
  if (to === from) return;
  if (await api('PATCH', from, { to })) {
    const wasCurrent = from === current;
    if (wasCurrent) current = null;
    await refresh();
    if (wasCurrent) await openFile(to);
  }
};

$('mDelete').onclick = async () => {
  const p = menuPath;
  if (!confirm('Delete ' + p + '? This cannot be undone from the viewer.')) return;
  if (await api('DELETE', p)) {
    if (p === current) {
      stopEditing();
      current = null;
      original = '';
      $('title').textContent = 'Choose a file';
      $('btnEdit').disabled = true;
      $('view').innerHTML = '<p class="empty">File deleted.</p>';
      $('toc').classList.remove('has');
      history.replaceState(null, '', location.pathname);
    }
    await refresh();
  }
};

loadTree().then(() => {
  const p = decodeURIComponent(location.hash.slice(1));
  if (p) openFile(p);
});
