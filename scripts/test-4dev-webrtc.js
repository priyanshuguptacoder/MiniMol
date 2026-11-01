#!/usr/bin/env node
// scripts/test-4dev-webrtc.js
// Complete End-to-End Verification of SplitInfer 4-Device WebRTC Cluster Pipeline:
// Topology:
//   Device 0 (Stage 0) ---> Device 1 (Stage 1) ---> Device 2 (Stage 2) ---> Device 3 (Stage 3)
// Real RTCPeerConnections, STUN ICE negotiation, binary RTCDataChannels, and tensor transfer.

import { spawn } from 'child_process';
import fs from 'fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORTS = [9460, 9461, 9462, 9463];
const DIRS = PORTS.map(p => `/tmp/splitinfer-4dev-${p}-${Date.now()}`);

console.log('================================================================');
console.log('  SPLITINFER — 4-DEVICE WEBRTC PIPELINE INTEGRATION TEST');
console.log('================================================================\n');

// 1. Verify Signaling Server
console.log('[1/6] Checking Signaling Server health...');
const health = await fetch('http://127.0.0.1:4000/health').then(r => r.json()).catch(() => null);
if (!health || health.status !== 'ok') {
  console.error('❌ Signaling server not reachable at http://127.0.0.1:4000');
  process.exit(1);
}
console.log(`  ✓ Signaling Server online: uptime=${health.uptime}s, sessions=${health.sessions}`);

function spawnBrowser(port, dir) {
  fs.mkdirSync(dir, { recursive: true });
  return spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--allow-insecure-localhost',
  ], { stdio: 'ignore' });
}

class CDP {
  constructor(port, name) {
    this.port = port;
    this.name = name;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const list = await fetch(`http://127.0.0.1:${this.port}/json/list`).then(r => r.json());
        const page = list?.find(t => t.type === 'page') || list?.[0];
        if (page?.webSocketDebuggerUrl) {
          this.ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
          this.ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.id && this.callbacks.has(data.id)) {
              this.callbacks.get(data.id)(data);
              this.callbacks.delete(data.id);
            }
          };
          return;
        }
      } catch {}
    }
    throw new Error(`CDP connection failed on port ${this.port}`);
  }

  send(method, params = {}) {
    return new Promise(res => {
      const id = this.msgId++;
      this.callbacks.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(`[${this.name}] ` + JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  }

  close() {
    this.ws?.close();
  }
}

const procs = PORTS.map((p, idx) => spawnBrowser(p, DIRS[idx]));
const cdps = PORTS.map((p, idx) => new CDP(p, `Device ${idx}`));

try {
  console.log('\n[2/6] Spawning 4 isolated browser instances...');
  await Promise.all(cdps.map(c => c.connect()));
  console.log('  ✓ 4 instances active (Ports: 9460, 9461, 9462, 9463)');

  // Enable Console API to see browser logs
  for (const c of cdps) {
    await c.send('Console.enable');
  }

  // Device 0 creates session
  console.log('\n[3/6] Device 0 (Host): Creating cluster session...');
  await cdps[0].send('Page.navigate', { url: 'http://localhost:5173/sessions/create' });
  await new Promise(r => setTimeout(r, 1500));

  const sessionRes = await cdps[0].eval(`
    (async () => {
      let clicked = false;
      for (let i = 0; i < 100; i++) {
        const root = document.getElementById('root');
        if (root && root.children.length > 0) {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            b.textContent && (b.textContent.includes('Initialize Session') || b.textContent.includes('Create Session'))
          );
          if (btn && !btn.disabled) {
            btn.click();
            clicked = true;
            break;
          }
        }
        await new Promise(r => setTimeout(r, 150));
      }
      if (!clicked) return { error: 'Initialize Session button not found or not clickable' };

      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 150));
        const codeElem = document.querySelector('.select-all');
        if (codeElem && codeElem.textContent.trim().startsWith('SI-')) {
          return { sessionId: codeElem.textContent.trim() };
        }
      }
      return { error: 'Timeout waiting for session code' };
    })()
  `);

  if (!sessionRes?.sessionId) {
    throw new Error('Device 0 failed to create session: ' + JSON.stringify(sessionRes));
  }
  const sessionId = sessionRes.sessionId;
  console.log(`  ✓ Session created: ${sessionId}`);

  // Devices 1, 2, 3 join session sequentially
  console.log('\n[4/6] Devices 1, 2, 3: Joining session as compute nodes...');
  for (let idx = 1; idx <= 3; idx++) {
    const joinUrl = `http://localhost:5173/sessions/join?code=${sessionId}`;
    await cdps[idx].send('Page.navigate', { url: joinUrl });
    await new Promise(r => setTimeout(r, 1500));

    const joinRes = await cdps[idx].eval(`
      (async () => {
        let clicked = false;
        for (let i = 0; i < 100; i++) {
          const root = document.getElementById('root');
          if (root && root.children.length > 0) {
            const btn = Array.from(document.querySelectorAll('button')).find(b =>
              b.textContent && b.textContent.includes('Join as Compute Node')
            );
            if (btn && !btn.disabled) {
              btn.click();
              clicked = true;
              break;
            }
          }
          await new Promise(r => setTimeout(r, 150));
        }
        if (!clicked) return { ok: false, error: 'Join button not clickable' };

        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 150));
          if (document.body.innerText.includes('Registered Device ID') || document.body.innerText.includes('Device Responsibility')) {
            return { ok: true };
          }
          if (document.querySelector('.text-danger')) {
            return { ok: false, error: document.querySelector('.text-danger')?.innerText };
          }
        }
        return { ok: false, error: 'Timeout waiting for join registration' };
      })()
    `);
    if (!joinRes?.ok) throw new Error(`Device ${idx} failed to join session: ` + JSON.stringify(joinRes));
    console.log(`  ✓ Device ${idx} joined session`);
  }

  // Verify server session
  const serverSess = await fetch(`http://127.0.0.1:4000/sessions/${sessionId}`).then(r => r.json());
  console.log(`\n  Signaling Server Membership (${serverSess.deviceCount} nodes):`);
  serverSess.devices.forEach((d, i) => {
    console.log(`    - Device ${i}: Socket=${d.socketId.slice(0, 10)}... | Assigned Stage=${d.stageIndex}`);
  });

  // Host navigates to /network
  console.log('\n[5/6] Device 0: Navigating to Network visualization page...');
  await cdps[0].eval(`
    (() => {
      const link = document.querySelector('a[href="/network"]');
      if (link) link.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  // Device IDs mapping
  const devIds = [];
  for (let i = 0; i <= 3; i++) {
    const devId = await cdps[i].eval(`window.__useSessionStore?.getState()?.myDeviceId`);
    devIds.push(devId);
  }
  console.log('\n  Cluster Device IDs:');
  devIds.forEach((id, i) => console.log(`    Stage ${i}: ${id}`));

  // 6. Verify 3 Adjacent WebRTC Peer Connections
  console.log('\n[6/6] Verifying WebRTC Peer Connections across the 3 pipeline hops...');
  console.log('      Expected topology: Stage 0 -> Stage 1 -> Stage 2 -> Stage 3');

  // Let connections establish
  console.log('      Waiting for ICE negotiation and DataChannels to reach OPEN...');

  async function checkPeerStatus(fromCdp, targetPeerId) {
    return await fromCdp.eval(`
      (() => {
        const peers = window.__useNetworkStore?.getState()?.peers || {};
        const p = peers['${targetPeerId}'];
        if (!p) return null;
        return {
          peerId: p.peerId,
          status: p.status,
          iceState: p.iceState,
          connectionState: p.connectionState,
          channelStatus: p.channelStatus,
          localCandidateType: p.localCandidateType,
          remoteCandidateType: p.remoteCandidateType,
          selectedCandidatePair: p.selectedCandidatePair,
          rttMs: p.rttMs,
        };
      })()
    `);
  }

  // Poll for up to 15 seconds
  let allHopsOpen = false;
  let hop0_1 = null;
  let hop1_2 = null;
  let hop2_3 = null;

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    hop0_1 = await checkPeerStatus(cdps[0], devIds[1]);
    hop1_2 = await checkPeerStatus(cdps[1], devIds[2]);
    hop2_3 = await checkPeerStatus(cdps[2], devIds[3]);

    const h0Open = hop0_1?.channelStatus === 'open' && (hop0_1?.iceState === 'connected' || hop0_1?.iceState === 'completed');
    const h1Open = hop1_2?.channelStatus === 'open' && (hop1_2?.iceState === 'connected' || hop1_2?.iceState === 'completed');
    const h2Open = hop2_3?.channelStatus === 'open' && (hop2_3?.iceState === 'connected' || hop2_3?.iceState === 'completed');

    if (h0Open && h1Open && h2Open) {
      allHopsOpen = true;
      break;
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log('  WEBRTC CONNECTION STATUS REPORT');
  console.log('----------------------------------------------------------------');

  console.log(`\n  Hop 1: Device 0 (Stage 0) -> Device 1 (Stage 1):`);
  console.log(`    - ICE Connection State : ${hop0_1?.iceState || 'unknown'}`);
  console.log(`    - Peer Connection State: ${hop0_1?.connectionState || 'unknown'}`);
  console.log(`    - RTCDataChannel State : ${hop0_1?.channelStatus || 'unknown'}`);
  console.log(`    - Selected Pair / Type : ${hop0_1?.selectedCandidatePair || hop0_1?.localCandidateType || 'host'}`);
  console.log(`    - Round-Trip Time (RTT): ${hop0_1?.rttMs ?? 'N/A'}ms`);

  console.log(`\n  Hop 2: Device 1 (Stage 1) -> Device 2 (Stage 2):`);
  console.log(`    - ICE Connection State : ${hop1_2?.iceState || 'unknown'}`);
  console.log(`    - Peer Connection State: ${hop1_2?.connectionState || 'unknown'}`);
  console.log(`    - RTCDataChannel State : ${hop1_2?.channelStatus || 'unknown'}`);
  console.log(`    - Selected Pair / Type : ${hop1_2?.selectedCandidatePair || hop1_2?.localCandidateType || 'host'}`);
  console.log(`    - Round-Trip Time (RTT): ${hop1_2?.rttMs ?? 'N/A'}ms`);

  console.log(`\n  Hop 3: Device 2 (Stage 2) -> Device 3 (Stage 3):`);
  console.log(`    - ICE Connection State : ${hop2_3?.iceState || 'unknown'}`);
  console.log(`    - Peer Connection State: ${hop2_3?.connectionState || 'unknown'}`);
  console.log(`    - RTCDataChannel State : ${hop2_3?.channelStatus || 'unknown'}`);
  console.log(`    - Selected Pair / Type : ${hop2_3?.selectedCandidatePair || hop2_3?.localCandidateType || 'host'}`);
  console.log(`    - Round-Trip Time (RTT): ${hop2_3?.rttMs ?? 'N/A'}ms`);

  if (!allHopsOpen) {
    console.error('\n❌ One or more pipeline hops did not reach OPEN state.');
  } else {
    console.log('\n  ✓ ALL 3 ADJACENT WEBRTC PIPELINE CONNECTIONS ARE FULLY OPEN!\n');
  }

  // 7. Test Float32Array Tensor Transfer on each connection
  console.log('----------------------------------------------------------------');
  console.log('  FLOAT32ARRAY TENSOR TRANSFER VERIFICATION');
  console.log('----------------------------------------------------------------\n');

  async function testTransfer(senderCdp, senderStage, receiverStage, targetPeerId) {
    console.log(`  Testing Tensor Transfer: Stage ${senderStage} -> Stage ${receiverStage}...`);
    const res = await senderCdp.eval(`
      (async () => {
        const pm = window.__peerManager;
        if (!pm) return { error: 'No PeerManager' };
        return await pm.testTensorTransfer('${targetPeerId}');
      })()
    `);
    console.log(`    Result: Success=${res?.success} | Bytes=${res?.bytes} | Duration=${res?.durationMs}ms ${res?.error ? `| Error=${res.error}` : ''}`);
    return res;
  }

  const t01 = await testTransfer(cdps[0], 0, 1, devIds[1]);
  const t12 = await testTransfer(cdps[1], 1, 2, devIds[2]);
  const t23 = await testTransfer(cdps[2], 2, 3, devIds[3]);

  console.log('\n================================================================');
  if (t01?.success && t12?.success && t23?.success) {
    console.log('  🎉 SUCCESS: ALL 3 WEBRTC HOPS FULLY CONNECTED & TRANSFERRED TENSORS!');
  } else {
    console.log('  ⚠️ WARNING: Tensor transfer completed with issues on some hops.');
  }
  console.log('================================================================\n');

} catch (err) {
  console.error('\n❌ Test execution error:', err);
} finally {
  cdps.forEach(c => c.close());
  procs.forEach(p => p.kill());
  DIRS.forEach(d => {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });
}
