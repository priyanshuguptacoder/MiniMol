# SplitInfer

> **One Model. Many Devices. Zero Centralized GPU.**  
> Distributed Transformer Inference Across Connected Smartphones and Laptops via Browser WebAssembly and WebRTC DataChannels.

---

## Overview

SplitInfer is a browser-native distributed AI inference platform. It enables multiple physical devices (such as everyday smartphones, tablets, and laptops) to collaborate in executing a single deep Transformer language model without relying on a centralized GPU server.

- **Model Partitioning**: The Transformer is divided into sequential stage subgraphs (one block per device).
- **Edge Computation**: Each device compiles and runs its assigned stage locally using **ONNX Runtime Web** (WebAssembly + SIMD).
- **Direct Peer Transport**: Intermediate hidden activation tensors are streamed directly between devices through **WebRTC DataChannels** with binary framing.
- **Zero Tensor Relay**: The central signaling server is only used for session creation and SDP/ICE negotiation.

---

## Quickstart

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Transformer & Export ONNX Partitions
Trains the 4-layer Transformer in PyTorch, exports the 4 stages, and validates numerical parity:
```bash
npm run model:build
```

### 3. Launch the Signaling Server (Terminal 1)
```bash
npm run dev:server
```
Runs at `http://0.0.0.0:4000`.

### 4. Launch the Web Application (Terminal 2)
```bash
npm run dev
```
Accessible locally at `http://localhost:5173` and on your local Wi-Fi at `http://<LAN_IP>:5173`.

---

## Verifying the Project

Run all validation checks:

```bash
# Typecheck TypeScript across all components, stores, and services
npm run typecheck

# Lint workspace
npm run lint

# Run automated Vitest test suite (protocol, manifest, stores, signaling)
npm run test

# Compile production bundle
npm run build
```

---

## Connecting Mobile Phones

1. Open `http://<YOUR_LAN_IP>:5173/sessions/create` on your laptop.
2. Click **Initialize Session** to generate a room code and QR code.
3. Open the camera on your phone (connected to the same Wi-Fi) and scan the QR code.
4. The phone will open `http://<YOUR_LAN_IP>:5173/sessions/join?code=SI-XXXX` and register as an edge compute node.
5. In the **Playground** (`/playground`), load the stage models and click **Run Pipeline Inference**.
6. Hidden activation tensors will flow directly between the laptop and phone, with text streaming live!

For detailed network troubleshooting, see [`docs/LOCAL_DEVICE_TESTING.md`](docs/LOCAL_DEVICE_TESTING.md) and [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

---

## Documentation Index

- [`ARCHITECTURE.md`](ARCHITECTURE.md): Distributed pipeline architecture and system components.
- [`PROJECT_STATUS.md`](PROJECT_STATUS.md): Verification matrix and test results.
- [`docs/NETWORK_PROTOCOL.md`](docs/NETWORK_PROTOCOL.md): 16-byte binary framing specification and signaling format.
- [`docs/MODEL_EXPORT.md`](docs/MODEL_EXPORT.md): Model hyperparameters, stage inputs/outputs, and numerical validation.
- [`docs/LOCAL_DEVICE_TESTING.md`](docs/LOCAL_DEVICE_TESTING.md): Step-by-step physical device testing guide.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md): Wi-Fi AP isolation, HTTPS secure context, and WASM memory limits.

---

## License

MIT
