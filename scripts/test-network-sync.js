// scripts/test-network-sync.js
// Verification of real-time peer join sync on NetworkPage

import { spawn } from 'child_process';
import fs from 'fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_HOST = 9450;
const PORT_NODE = 9451;
const DIR_HOST = `/tmp/splitinfer-net-host-${Date.now()}`;
const DIR_NODE = `/tmp/splitinfer-net-node-${Date.now()}`;

function spawnDev(port, dir) {
  fs.mkdirSync(dir, { recursive: true });
  return spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--allow-insecure-localhost',
  ], { stdio: 'ignore' });
}

class CDP {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.msgId = 1;
    this.cbs = new Map();
  }
  async connect() {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const list = await fetch(`http://127.0.0.1:${this.port}/json/list`).then(r => r.json());
        if (list?.[0]) {
          this.ws = new WebSocket(list[0].webSocketDebuggerUrl);
          await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
          this.ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.id && this.cbs.has(data.id)) {
              this.cbs.get(data.id)(data);
              this.cbs.delete(data.id);
            }
          };
          return;
        }
      } catch {}
    }
    throw new Error('CDP connect failed');
  }
  send(method, params = {}) {
    return new Promise(res => {
      const id = this.msgId++;
      this.cbs.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  }
  close() { this.ws?.close(); }
}

const pHost = spawnDev(PORT_HOST, DIR_HOST);
const pNode = spawnDev(PORT_NODE, DIR_NODE);
const cdpHost = new CDP(PORT_HOST);
const cdpNode = new CDP(PORT_NODE);

try {
  await Promise.all([cdpHost.connect(), cdpNode.connect()]);
  console.log('✓ Host and Node browser instances spawned');

  // 1. Host creates session
  await cdpHost.send('Page.navigate', { url: 'http://localhost:5173/sessions/create' });
  await new Promise(r => setTimeout(r, 1500));
  const sid = await cdpHost.eval(`
    (async () => {
      let btn = null;
      for (let i = 0; i < 50; i++) {
        btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Initialize Session'));
        if (btn) break;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!btn) return null;
      btn.click();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        const c = document.querySelector('.select-all');
        if (c?.textContent.trim().startsWith('SI-')) return c.textContent.trim();
      }
      return null;
    })()
  `);
  console.log('✓ Host created session:', sid);
  if (!sid) throw new Error('Host failed to obtain session ID');

  // 2. Host navigates to /network via SPA Client Router (preserving socket)
  await cdpHost.eval(`
    (() => {
      const netLink = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') === '/network' || a.textContent.includes('Network'));
      if (netLink) {
        netLink.click();
      } else {
        window.location.href = '/network';
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));
  const initHostCount = await cdpHost.eval(`document.querySelectorAll('.font-mono').length`);
  console.log('✓ Host is on Network page, initial devices visible:', initHostCount);

  // 3. Node joins via join page
  await cdpNode.send('Page.navigate', { url: `http://localhost:5173/sessions/join?code=${sid}` });
  await new Promise(r => setTimeout(r, 1200));
  const nodeJoin = await cdpNode.eval(`
    (async () => {
      let b = null;
      for (let i = 0; i < 40; i++) {
        b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Join as Compute Node'));
        if (b && !b.disabled) break;
        await new Promise(r => setTimeout(r, 100));
      }
      b?.click();
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (document.body.innerText.includes('Connected to Cluster Session!')) return { ok: true, text: document.body.innerText };
      }
      return { ok: false, text: document.body.innerText };
    })()
  `);
  console.log('✓ Node joined session result:', nodeJoin.ok ? 'SUCCESS' : 'FAILED');
  if (!nodeJoin.ok) {
    console.log('Node page text:', nodeJoin.text);
  }

  // 4. Check if Host Network page automatically synced and updated devices list!
  let synced = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 100));
    const hostBody = await cdpHost.eval(`document.body.innerText`);
    if (hostBody.includes('Stage 1') || hostBody.includes('Devices: 2')) {
      synced = true;
      break;
    }
  }

  const hostFinalCount = await cdpHost.eval(`document.querySelectorAll('.font-mono').length`);
  const hostDiagnostics = await cdpHost.eval(`
    Array.from(document.querySelectorAll('.p-4 .leading-tight')).map(el => el.textContent)
  `);

  console.log('\n--- VERIFICATION REPORT ---');
  console.log('Network page auto-sync active:', synced ? 'PASSED ✓' : 'FAILED ✗');
  console.log('Host Network diagnostics:', hostDiagnostics);
  console.log('---------------------------\n');

  if (!synced) throw new Error('Host Network page failed to sync joined peer!');
} finally {
  cdpHost.close();
  cdpNode.close();
  pHost.kill('SIGKILL');
  pNode.kill('SIGKILL');
  await new Promise(r => setTimeout(r, 500));
  try { fs.rmSync(DIR_HOST, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(DIR_NODE, { recursive: true, force: true }); } catch {}
}
