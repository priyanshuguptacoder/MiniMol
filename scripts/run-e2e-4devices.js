#!/usr/bin/env node
// scripts/run-e2e-4devices.js
// Automated 4-Device Physical / Headless Browser Integration Test for SplitInfer
// Spawns 4 isolated browser instances (Device 0, 1, 2, 3) representing a full
// 4-stage distributed cluster pipeline.

import { spawn } from 'child_process';
import fs from 'fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORTS = [9444, 9445, 9446, 9447];
const DIRS = PORTS.map(p => `/tmp/splitinfer-dev-${p}-${Date.now()}`);

console.log('================================================================');
console.log('  SPLITINFER — 4-DEVICE CLUSTER PIPELINE INTEGRATION TEST');
console.log('================================================================\n');

// 1. Check Servers Alive
console.log('[1/7] Verifying signaling and frontend servers...');
const healthRes = await fetch('http://127.0.0.1:4000/health').then(r => r.json()).catch(() => null);
if (!healthRes || healthRes.status !== 'ok') {
  console.error('❌ Signaling server is not healthy at http://127.0.0.1:4000');
  process.exit(1);
}
console.log(`  ✓ Signaling Server alive: uptime=${healthRes.uptime}s, sessions=${healthRes.sessions}`);

function spawnDevice(name, port, userDir) {
  fs.mkdirSync(userDir, { recursive: true });
  return spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--allow-insecure-localhost',
  ], { stdio: 'ignore' });
}

class CDPClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) {
          const list = await fetch(`http://127.0.0.1:${this.port}/json/list`).then(r => r.json());
          const target = list[0];
          this.ws = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
          });
          this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.id && this.callbacks.has(data.id)) {
              this.callbacks.get(data.id)(data);
              this.callbacks.delete(data.id);
            }
          };
          return;
        }
      } catch {}
    }
    throw new Error(`Failed to connect to CDP on port ${this.port}`);
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = this.msgId++;
      this.callbacks.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  }

  close() {
    this.ws?.close();
  }
}

console.log('[2/7] Spawning 4 isolated browser instances...');
const procs = PORTS.map((p, idx) => spawnDevice(`Device ${idx}`, p, DIRS[idx]));
const cdps = PORTS.map(p => new CDPClient(p));

try {
  await Promise.all(cdps.map(c => c.connect()));
  console.log('  ✓ 4 isolated browser instances initialized (Ports: 9444, 9445, 9446, 9447)\n');

  // Navigate Device 0 to Create Session
  console.log('[3/7] Device 0 (Host): Creating session...');
  await cdps[0].send('Page.navigate', { url: 'http://localhost:5173/sessions/create' });
  await new Promise(r => setTimeout(r, 1500));

  const sessionInfo = await cdps[0].evaluate(`
    (async () => {
      let btn = null;
      for (let i = 0; i < 50; i++) {
        btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Initialize Session') || b.textContent.includes('Create Session'));
        if (btn) break;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!btn) return { error: 'Button not found' };
      btn.click();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        const codeElem = document.querySelector('.select-all');
        if (codeElem && codeElem.textContent.trim().startsWith('SI-')) {
          return { sessionId: codeElem.textContent.trim() };
        }
      }
      return { error: 'Timeout waiting for session ID' };
    })()
  `);

  if (!sessionInfo?.sessionId) {
    throw new Error('Device 0 failed to create session: ' + JSON.stringify(sessionInfo));
  }
  const sessionId = sessionInfo.sessionId;
  console.log(`  ✓ Session created: ${sessionId}\n`);

  // Devices 1, 2, 3 join the session
  console.log('[4/7] Devices 1, 2, 3: Joining session concurrently...');
  for (let idx = 1; idx <= 3; idx++) {
    const joinUrl = `http://localhost:5173/sessions/join?code=${sessionId}`;
    await cdps[idx].send('Page.navigate', { url: joinUrl });
    await new Promise(r => setTimeout(r, 1200));

    const joinRes = await cdps[idx].evaluate(`
      (async () => {
        let btn = null;
        for (let i = 0; i < 50; i++) {
          btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Join as Compute Node') || b.textContent.includes('Join Session'));
          if (btn && !btn.disabled) break;
          await new Promise(r => setTimeout(r, 100));
        }
        if (!btn) return false;
        btn.click();
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (document.body.innerText.includes('Connected to Cluster') || document.body.innerText.includes('Joined session')) {
            return true;
          }
        }
        return false;
      })()
    `);
    if (!joinRes) throw new Error(`Device ${idx} failed to join session`);
    console.log(`  ✓ Device ${idx} joined session`);
  }

  // Verify all 4 devices registered on signaling server
  const sessionCheck = await fetch(`http://127.0.0.1:4000/sessions/${sessionId}`).then(r => r.json());
  console.log(`\n  Signaling Server Report: ${sessionCheck.deviceCount} registered devices:`);
  sessionCheck.devices.forEach((d, i) => {
    console.log(`    - Device ${i}: ID=${d.deviceId}, Assigned Stage=${d.stageIndex}`);
  });
  if (sessionCheck.deviceCount !== 4) {
    throw new Error(`Expected 4 devices, found ${sessionCheck.deviceCount}`);
  }
  console.log('  ✓ Full 4-device cluster confirmed!\n');

  // Setup WebRTC DataChannel Pipeline: 0 -> 1 -> 2 -> 3
  console.log('[5/7] Establishing WebRTC DataChannels along pipeline (0 -> 1 -> 2 -> 3)...');

  async function establishPeerChannel(senderCdp, receiverCdp, channelName) {
    // Receiver prepares
    await receiverCdp.evaluate(`
      window.__inChannel = null;
      window.__pcRecv = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      window.__iceCandidatesRecv = [];
      window.__pcRecv.onicecandidate = (e) => { if (e.candidate) window.__iceCandidatesRecv.push(e.candidate.toJSON()); };
      window.__pcRecv.ondatachannel = (e) => {
        window.__inChannel = e.channel;
        window.__inChannel.binaryType = 'arraybuffer';
        window.__inChannel.onmessage = (msg) => { window.__recvBuffer = msg.data; };
      };
    `);

    // Sender creates offer & datachannel
    const offer = await senderCdp.evaluate(`
      (async () => {
        window.__outChannel = null;
        window.__pcSend = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        window.__iceCandidatesSend = [];
        window.__pcSend.onicecandidate = (e) => { if (e.candidate) window.__iceCandidatesSend.push(e.candidate.toJSON()); };
        window.__outChannel = window.__pcSend.createDataChannel('${channelName}', { ordered: true });
        window.__outChannel.binaryType = 'arraybuffer';
        const off = await window.__pcSend.createOffer();
        await window.__pcSend.setLocalDescription(off);
        return window.__pcSend.localDescription.toJSON();
      })()
    `);

    // Receiver sets remote & creates answer
    const answer = await receiverCdp.evaluate(`
      (async () => {
        await window.__pcRecv.setRemoteDescription(${JSON.stringify(offer)});
        const ans = await window.__pcRecv.createAnswer();
        await window.__pcRecv.setLocalDescription(ans);
        return window.__pcRecv.localDescription.toJSON();
      })()
    `);

    // Sender sets remote answer
    await senderCdp.evaluate(`window.__pcSend.setRemoteDescription(${JSON.stringify(answer)})`);

    // Trickle ICE candidates
    let idxS = 0;
    let idxR = 0;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 80));
      const newS = await senderCdp.evaluate(`window.__iceCandidatesSend.slice(${idxS})`);
      if (newS?.length > 0) {
        idxS += newS.length;
        for (const c of newS) await receiverCdp.evaluate(`window.__pcRecv.addIceCandidate(${JSON.stringify(c)}).catch(() => {})`);
      }
      const newR = await receiverCdp.evaluate(`window.__iceCandidatesRecv.slice(${idxR})`);
      if (newR?.length > 0) {
        idxR += newR.length;
        for (const c of newR) await senderCdp.evaluate(`window.__pcSend.addIceCandidate(${JSON.stringify(c)}).catch(() => {})`);
      }

      const sendOpen = await senderCdp.evaluate(`window.__outChannel?.readyState === 'open'`);
      const recvOpen = await receiverCdp.evaluate(`window.__inChannel?.readyState === 'open'`);
      if (sendOpen && recvOpen) return true;
    }
    throw new Error(`DataChannel '${channelName}' failed to open`);
  }

  await establishPeerChannel(cdps[0], cdps[1], 'pipe-0-1');
  console.log('  ✓ DataChannel established: Device 0 -> Device 1 (OPEN)');
  await establishPeerChannel(cdps[1], cdps[2], 'pipe-1-2');
  console.log('  ✓ DataChannel established: Device 1 -> Device 2 (OPEN)');
  await establishPeerChannel(cdps[2], cdps[3], 'pipe-2-3');
  console.log('  ✓ DataChannel established: Device 2 -> Device 3 (OPEN)\n');

  // Load partitions on each device independently
  console.log('[6/7] Compiling ONNX partitions on all 4 devices via InferenceEngine...');
  await cdps[0].evaluate(`
    (async () => {
      const { loadStage, runStageAtIndex } = await import('/src/services/InferenceEngine.ts');
      window.__run = runStageAtIndex;
      await loadStage('/models/stage-0.onnx', 0, 'token_ids', 'hidden_out');
    })()
  `);
  console.log('  ✓ Device 0 loaded Stage 0 partition');

  await cdps[1].evaluate(`
    (async () => {
      const { loadStage, runStageAtIndex } = await import('/src/services/InferenceEngine.ts');
      window.__run = runStageAtIndex;
      await loadStage('/models/stage-1.onnx', 1, 'hidden_in', 'hidden_out');
    })()
  `);
  console.log('  ✓ Device 1 loaded Stage 1 partition');

  await cdps[2].evaluate(`
    (async () => {
      const { loadStage, runStageAtIndex } = await import('/src/services/InferenceEngine.ts');
      window.__run = runStageAtIndex;
      await loadStage('/models/stage-2.onnx', 2, 'hidden_in', 'hidden_out');
    })()
  `);
  console.log('  ✓ Device 2 loaded Stage 2 partition');

  await cdps[3].evaluate(`
    (async () => {
      const { loadStage, runStageAtIndex } = await import('/src/services/InferenceEngine.ts');
      window.__run = runStageAtIndex;
      await loadStage('/models/stage-3.onnx', 3, 'hidden_in', 'logits');
    })()
  `);
  console.log('  ✓ Device 3 loaded Stage 3 partition\n');

  // Execute 4-Stage Distributed Pipeline:
  console.log('[7/7] Executing Distributed Forward Pass across all 4 devices...');
  const promptText = "to be or not to be that is";

  // Step 1: Device 0 runs Stage 0 & sends to Device 1
  const t0Start = Date.now();
  const d0Res = await cdps[0].evaluate(`
    (async () => {
      const text = "${promptText}";
      const rawIds = Array.from(text).map(c => BigInt(c.charCodeAt(0) - 32));
      const tokens = new BigInt64Array(64);
      const offset = 64 - rawIds.length;
      for (let i = 0; i < rawIds.length; i++) tokens[offset + i] = rawIds[i];

      const start = performance.now();
      const h0 = await window.__run(0, tokens, [1, 64]);
      const dur = performance.now() - start;

      const frame = new ArrayBuffer(16 + h0.byteLength);
      const v = new DataView(frame);
      v.setUint8(0, 1);
      v.setUint8(1, 1);
      v.setUint16(2, 1, true);
      v.setUint32(12, h0.byteLength, true);
      new Uint8Array(frame, 16).set(new Uint8Array(h0.buffer));
      window.__outChannel.send(frame);
      return { dur, bytes: frame.byteLength };
    })()
  `);
  console.log(`  ✓ Device 0: Stage 0 executed in ${d0Res.dur.toFixed(2)}ms -> sent ${d0Res.bytes} bytes to Device 1`);

  // Step 2: Device 1 waits for buffer, executes Stage 1 & sends to Device 2
  for (let i = 0; i < 30; i++) {
    if (await cdps[1].evaluate(`!!window.__recvBuffer`)) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const d1Res = await cdps[1].evaluate(`
    (async () => {
      const input = new Float32Array(window.__recvBuffer.slice(16));
      window.__recvBuffer = null;
      const start = performance.now();
      const h1 = await window.__run(1, input, [1, 64, 64]);
      const dur = performance.now() - start;

      const frame = new ArrayBuffer(16 + h1.byteLength);
      const v = new DataView(frame);
      v.setUint8(0, 1);
      v.setUint8(1, 1);
      v.setUint16(2, 2, true);
      v.setUint32(12, h1.byteLength, true);
      new Uint8Array(frame, 16).set(new Uint8Array(h1.buffer));
      window.__outChannel.send(frame);
      return { dur, bytes: frame.byteLength };
    })()
  `);
  console.log(`  ✓ Device 1: Stage 1 executed in ${d1Res.dur.toFixed(2)}ms -> sent ${d1Res.bytes} bytes to Device 2`);

  // Step 3: Device 2 waits for buffer, executes Stage 2 & sends to Device 3
  for (let i = 0; i < 30; i++) {
    if (await cdps[2].evaluate(`!!window.__recvBuffer`)) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const d2Res = await cdps[2].evaluate(`
    (async () => {
      const input = new Float32Array(window.__recvBuffer.slice(16));
      window.__recvBuffer = null;
      const start = performance.now();
      const h2 = await window.__run(2, input, [1, 64, 64]);
      const dur = performance.now() - start;

      const frame = new ArrayBuffer(16 + h2.byteLength);
      const v = new DataView(frame);
      v.setUint8(0, 1);
      v.setUint8(1, 1);
      v.setUint16(2, 3, true);
      v.setUint32(12, h2.byteLength, true);
      new Uint8Array(frame, 16).set(new Uint8Array(h2.buffer));
      window.__outChannel.send(frame);
      return { dur, bytes: frame.byteLength };
    })()
  `);
  console.log(`  ✓ Device 2: Stage 2 executed in ${d2Res.dur.toFixed(2)}ms -> sent ${d2Res.bytes} bytes to Device 3`);

  // Step 4: Device 3 waits for buffer, executes Stage 3 & produces final output
  for (let i = 0; i < 30; i++) {
    if (await cdps[3].evaluate(`!!window.__recvBuffer`)) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const d3Res = await cdps[3].evaluate(`
    (async () => {
      const input = new Float32Array(window.__recvBuffer.slice(16));
      window.__recvBuffer = null;
      const start = performance.now();
      const logits = await window.__run(3, input, [1, 64, 64]);
      const dur = performance.now() - start;

      // Extract last position logits
      const lastLogits = Array.from(logits.slice(63 * 96, 64 * 96));
      let maxVal = -Infinity;
      let argmax = 0;
      for (let i = 0; i < lastLogits.length; i++) {
        if (lastLogits[i] > maxVal) {
          maxVal = lastLogits[i];
          argmax = i;
        }
      }
      const char = String.fromCharCode(argmax + 32);
      return {
        dur,
        totalElements: logits.length,
        argmax,
        char,
        top5: lastLogits.slice(0, 5),
      };
    })()
  `);
  const totalE2ETime = Date.now() - t0Start;

  console.log(`  ✓ Device 3: Stage 3 executed in ${d3Res.dur.toFixed(2)}ms`);
  console.log(`\n================================================================`);
  console.log('  4-DEVICE PIPELINE INFERENCE RESULTS:');
  console.log('================================================================');
  console.log(`  Input Prompt:         "${promptText}"`);
  console.log(`  Next Predicted Token: '${d3Res.char}' (token_id: ${d3Res.argmax})`);
  console.log(`  Output Logits Shape:  [1, 64, 96] (${d3Res.totalElements} Float32 elements)`);
  console.log(`  Top 5 Logit Values:   [${d3Res.top5.map(v => v.toFixed(4)).join(', ')}]`);
  console.log(`  Latency Breakdown:`);
  console.log(`    - Device 0 (Stage 0): ${d0Res.dur.toFixed(2)} ms`);
  console.log(`    - Device 1 (Stage 1): ${d1Res.dur.toFixed(2)} ms`);
  console.log(`    - Device 2 (Stage 2): ${d2Res.dur.toFixed(2)} ms`);
  console.log(`    - Device 3 (Stage 3): ${d3Res.dur.toFixed(2)} ms`);
  console.log(`    - Total End-to-End Cluster Time: ${totalE2ETime} ms`);
  console.log('================================================================');
  console.log('\n🎉 ALL 4-DEVICE CLUSTER PIPELINE CHECKS PASSED!\n');

} finally {
  cdps.forEach(c => c.close());
  procs.forEach(p => p.kill('SIGKILL'));
  await new Promise(r => setTimeout(r, 600));
  DIRS.forEach(d => {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });
}
