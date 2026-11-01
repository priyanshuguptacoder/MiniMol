# SplitInfer System Architecture

SplitInfer is a distributed AI inference platform that divides deep neural network architectures across everyday edge devices (smartphones, tablets, and laptops) collaborating peer-to-peer over WebRTC.

---

## 1. High-Level System Architecture

```text
                               SPLITINFER CLUSTER
                       DECENTRALIZED PIPELINE PARALLELISM

                           +-------------------------+
                           |     Signaling Relay     |
                           |  (Socket.IO Port 4000)  |
                           +-------------------------+
                                        ▲
                         SDP / ICE Handshake Only
                                        ▼
    +─────────────────+  WebRTC DataChannel  +─────────────────+
    |    DEVICE 0     |=====================>|    DEVICE 1     |
    |  (Host Laptop)  |   Hidden Vector h0   |    (Phone 1)    |
    | Stage 0 Model   |      [1, 64, 64]     | Stage 1 Model   |
    | • Tokenizer     |                      | • Transformer   |
    | • Embeddings    |                      |   Block 2       |
    | • Block 1       |                      |                 |
    +─────────────────+                      +─────────────────+
                                                      │
                                             WebRTC DataChannel
                                              Hidden Vector h1
                                                [1, 64, 64]
                                                      ▼
    +─────────────────+  WebRTC DataChannel  +─────────────────+
    |    DEVICE 3     |<=====================|    DEVICE 2     |
    |    (Phone 3)    |   Hidden Vector h2   |    (Phone 2)    |
    | Stage 3 Model   |      [1, 64, 64]     | Stage 2 Model   |
    | • Block 4       |                      | • Transformer   |
    | • Final LN      |                      |   Block 3       |
    | • LM Head Logits|                      |                 |
    +─────────────────+                      +─────────────────+
             │
             ▼
     [Sample Next Token]
             │
             └─────────── (Token sent back to Device 0 via DataChannel)
```

---

## 2. Component Subsystems

### 1. `apps/signaling-server`
- Built with **Node.js, Express, and Socket.IO**.
- In-memory session coordinator managing room lifecycles, device capacities, and heartbeat monitors.
- Routes WebRTC SDP offers/answers and ICE candidate trickles between peers.
- **Zero tensor mediation**: Never touches or relays model tensors or intermediate activation arrays.

### 2. `packages/networking` & `src/services/PeerManager.ts`
- Manages `RTCPeerConnection` instances configured with STUN/TURN servers.
- Establishes ordered, reliable binary `RTCDataChannel` connections between pipeline neighbors.
- Implements 16-byte framing with chunking, sequencing, assembly, and latency ping/pong monitoring.

### 3. `tools/model-builder`
- PyTorch decoder-only causal Transformer trained on character corpus.
- Subgraph decomposition and ONNX partitioning into 4 stages:
  - `stage-0.onnx`: Embedding + Positional Encoding + Block 1 (Input: `token_ids`, Output: `hidden_out`)
  - `stage-1.onnx`: Block 2 (Input: `hidden_in`, Output: `hidden_out`)
  - `stage-2.onnx`: Block 3 (Input: `hidden_in`, Output: `hidden_out`)
  - `stage-3.onnx`: Block 4 + Final LN + Head (Input: `hidden_in`, Output: `logits`)
- Verified against monolithic reference with maximum numerical divergence of $8.34 \times 10^{-7}$.

### 4. `apps/web` (Client Application)
- **Vite + React 18 + TypeScript + Tailwind CSS**.
- **ONNX Runtime Web (WASM)** with SIMD multi-threading.
- **Zustand State Stores**: `useSessionStore`, `useNetworkStore`, `useInferenceStore`, `useHistoryStore`, `useSettingsStore`, `useDeviceStore`, `useModelStore`.
- **Pages**:
  - Landing Page: Hero, interactive pipeline explanation, tech pillars.
  - Dashboard: Cluster metrics, active session, connected peers, recent history.
  - Create Session: Room code generation, QR code for phone pairing.
  - Join Session: URL-parameter automatic code join, stage registration.
  - Session Overview: Cluster participant table, WebRTC peer connection states.
  - Network Visualization: Directed pipeline graph, live RTT and byte counters.
  - Inference Playground: Prompt input, temperature sampling, streaming output, execution logs.
  - Session History: IndexedDB/localStorage run records, JSON export, clear controls.
  - Settings: STUN/TURN configuration, backend selection (WASM/WebGPU), heartbeat intervals.
