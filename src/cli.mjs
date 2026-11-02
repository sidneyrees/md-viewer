// Browser mode: serve the viewer without Electron.
// Usage: node src/cli.mjs [folder] [port] [--open]
// Defaults to the last folder used, else the current folder, on port 4321 (next free if busy).
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { createViewerServer } from './server.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const open = process.argv.includes('--open');

try {
  const viewer = await createViewerServer({
    rendererDir: path.join(import.meta.dirname, 'renderer'),
    root: args[0],
    configPath: path.join(os.homedir(), '.md-viewer.json'),
    fallbackRoot: process.cwd(),
    port: Number(args[1] || 4321),
    portRange: 20,
  });
  console.log(`.MD Viewer: ${viewer.url}  (folder: ${viewer.getRoot()})`);
  if (open) {
    const cmd = { win32: 'start ""', darwin: 'open' }[process.platform] || 'xdg-open';
    exec(`${cmd} ${viewer.url}`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
