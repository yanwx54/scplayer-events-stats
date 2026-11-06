// Pull latest public/data from server HTTP (fallback when eloboard.com is unreachable)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const BASE = 'http://199.180.116.188:5001/data';

async function main() {
  // List all local data JSON files
  const localFiles = [];
  function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name.endsWith('.json')) localFiles.push(full);
    }
  }
  walk(DATA_DIR);
  console.log('Local data files:', localFiles.length);

  let changed = 0, same = 0, failed = 0;

  for (const localPath of localFiles) {
    // Convert local path to URL path
    const relFromData = path.relative(DATA_DIR, localPath).split(path.sep).join('/');
    const url = BASE + '/' + relFromData;
    try {
      const r = await fetch(url);
      if (!r.ok) { failed++; console.log('HTTP ' + r.status + ':', relFromData); continue; }
      const text = await r.text();
      const localText = fs.readFileSync(localPath, 'utf8');
      if (text !== localText) {
        fs.writeFileSync(localPath, text);
        changed++;
      } else {
        same++;
      }
    } catch(e) {
      failed++;
      console.log('FAIL:', relFromData, e.message);
    }
  }

  console.log('Result: changed=' + changed + ', same=' + same + ', failed=' + failed);
  console.log('PULL_FROM_SERVER_OK');
}

main().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
