# SplitInfer Local Device Testing & Multi-Device Setup Guide

This guide describes how to run and verify SplitInfer distributed inference across multiple physical smartphones (iOS / Android) and laptops on a local Wi-Fi network.

---

## Prerequisites

1. **Host Computer**:
   - Laptop or desktop running Node.js 18+ and npm.
   - Connected to the same Wi-Fi network as the test mobile devices.
2. **Mobile Devices**:
   - Modern browser (Safari on iOS 15+, Chrome on Android 10+).
   - Must have WebAssembly enabled (default on all modern mobile browsers).

---

## Step 1: Start the Signaling Server

In terminal 1 on your host laptop:

```bash
npm run dev:server
```

You should see:
```text
[SIG] Signaling server listening on http://0.0.0.0:4000
```

---

## Step 2: Start the Web Frontend

In terminal 2 on your host laptop:

```bash
npm run dev
```

Vite will bind to all network interfaces:
```text
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.X:5173/
```
Note your LAN IP address (e.g., `192.168.1.45`).

---

## Step 3: Configure Signaling Endpoint in Settings

1. Open `http://localhost:5173/settings` on your host laptop.
2. Verify the **Signaling Server URL** is set to `http://<YOUR_LAN_IP>:4000` (e.g. `http://192.168.1.45:4000`).
3. Click **Save Settings**.

---

## Step 4: Create a Session on Host Laptop

1. Go to `http://localhost:5173/sessions/create`.
2. Click **Initialize Session**.
3. A unique 6-character room code (e.g. `SI-7F2A`) and QR Code will be displayed.

---

## Step 5: Connect Mobile Devices

### Method A: Camera QR Scan (Recommended)
1. On each phone, open the Camera app and scan the QR code displayed on the laptop screen.
2. Tap the link to open `http://<YOUR_LAN_IP>:5173/sessions/join?code=SI-XXXX`.
3. Tap **Join as Compute Node**.

### Method B: Manual Code Entry
1. On phone 1, open `http://<YOUR_LAN_IP>:5173/sessions/join`.
2. Enter the room code (e.g. `SI-7F2A`) and tap **Join as Compute Node**.

The devices will automatically register with the cluster:
- **Laptop**: Stage 0 (Embedding + Block 1)
- **Phone 1**: Stage 1 (Block 2)
- **Phone 2**: Stage 2 (Block 3)
- **Phone 3**: Stage 3 (Block 4 + LM Output Head)

---

## Step 6: Execute Distributed Inference

1. On the laptop, navigate to the **Playground** (`/playground`).
2. Click **Load Stage 0** (each phone will load its corresponding stage).
3. Enter a prompt (e.g. `"to be or not to be that is"`) and click **Run Pipeline Inference**.
4. Observe:
   - Laptop computes Stage 0 and transmits hidden vectors directly to Phone 1.
   - Phone 1 receives activation via WebRTC DataChannel, runs WASM inference, and sends to Phone 2.
   - Final phone computes logits, samples the next token, and sends it back to the host.
   - Text streams in real time on the Playground output screen.
