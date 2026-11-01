# SplitInfer Troubleshooting & Diagnostics Guide

This document covers common networking, WebRTC, and browser WASM execution issues when running distributed inference across edge devices.

---

## 1. WebRTC DataChannel Fails to Connect Between Devices

### Symptoms:
- Devices join the session on the signaling server, but peer status shows `failed` or remains `connecting`.
- Diagnostics show `Timeout waiting for tensor at stage X`.

### Causes & Fixes:
1. **Firewall or Router Client Isolation**:
   - Some public Wi-Fi networks (e.g. coffee shops, universities, guest networks) enable **AP Isolation**, preventing devices on the same Wi-Fi from opening peer-to-peer UDP connections.
   - *Fix*: Connect devices to a personal mobile hotspot or a local home router where local peer-to-peer UDP traffic is allowed.
2. **Symmetric NAT**:
   - If devices are across different network subnets, direct STUN traversal may fail.
   - *Fix*: Configure a TURN relay server under `/settings` with valid TURN credentials.

---

## 2. HTTPS / Secure Context Requirements for WebRTC & SharedArrayBuffer

### Symptoms:
- Error: `WebRTC RTCPeerConnection is not available` or `SharedArrayBuffer is not defined`.

### Background:
- Modern mobile browsers require a **Secure Context (`https://` or `localhost`)** to access advanced Web APIs such as `SharedArrayBuffer` (multi-threaded WASM).
- When accessing the host via local IP (e.g., `http://192.168.1.X:5173`), some mobile browsers restrict multi-threaded WebAssembly and fall back to single-threaded SIMD execution.

### Fixes:
1. **Self-signed HTTPS with Vite**:
   - Install `@vitejs/plugin-basic-ssl` and enable HTTPS in `vite.config.ts`.
2. **Tunneling via Cloudflare / Ngrok**:
   ```bash
   npx cloudflared tunnel --url http://localhost:5173
   ```
   Provides a free public `https://*.trycloudflare.com` URL that satisfies all browser secure-context requirements on any mobile network.

---

## 3. iOS Safari Background Tab Throttling

### Symptoms:
- When a phone screen locks or switches to another tab, inference pauses or drops connection.

### Explanation:
- Mobile Safari and Chrome pause WebAssembly execution and throttle WebRTC background timers to preserve battery.

### Fix:
- Keep the SplitInfer tab open and screen awake on all connected phones during active inference runs.

---

## 4. WASM Out of Memory on Low-End Mobile Devices

### Symptoms:
- `RangeError: WebAssembly.Memory(): could not allocate memory`.

### Fix:
- SplitInfer was explicitly designed to prevent this: each device only loads a single ~200 KB stage partition into WASM memory rather than a multi-gigabyte monolithic model.
- If memory allocation fails on an ultra-constrained phone, reduce `maxTokens` in the Playground or close background browser tabs.
