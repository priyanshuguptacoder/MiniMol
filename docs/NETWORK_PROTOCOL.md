# SplitInfer Network Protocol Specification

This document details the two-tier communication architecture used by SplitInfer: the WebSocket signaling relay and the peer-to-peer WebRTC binary DataChannel transport.

---

## 1. Architectural Separation

SplitInfer strictly separates **connection negotiation** from **tensor computation and transmission**:

```text
               +----------------------------------+
               | WebSocket Signaling Server       |
               | (Port 4000: Node.js + Socket.IO) |
               +----------------------------------+
                     ^                     ^
      SDP / ICE      |                     |      SDP / ICE
      Signaling Only |                     |      Signaling Only
                     v                     v
              +------------+         +------------+
              |  Device A  |<=======>|  Device B  |
              |  (Host)    | Direct  |  (Node 1)  |
              +------------+ WebRTC  +------------+
                             Binary
                             DataChannel
                             (Zero Server Relay)
```

1. **Signaling Tier (WebSocket / Socket.IO)**:
   - Used **only** for session establishment, peer discovery, hardware capability exchange, and WebRTC SDP offer/answer & ICE candidate routing.
   - **Never transmits intermediate activations or model weights.**

2. **Data Tier (WebRTC DataChannel)**:
   - Direct, encrypted peer-to-peer link using SCTP over DTLS over UDP.
   - Operates entirely on the local Wi-Fi / LAN network or direct peer route without passing through any server.
   - Transfers raw IEEE-754 `Float32Array` activation tensors between pipeline stages.

---

## 2. WebRTC Binary Framing Format

Activations between transformer blocks are transferred as raw binary frames with a 16-byte fixed binary header followed by sliced payload chunks:

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Version (1B)  | Frame Type(1B)|      Stage Index (2B, LE)     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Total Chunks (4B, LE)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Chunk Index (4B, LE)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Total Bytes (4B, LE)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                 Payload Slice (Variable Length)               |
|                              ...                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Frame Types:
- `0x01` (`TENSOR`): Intermediate activation chunk or generated token ID.
- `0x02` (`PING`): Keep-alive and latency measurement probe (includes 64-bit float epoch timestamp).
- `0x03` (`PONG`): Latency measurement reply (echoes probe timestamp for RTT calculation).

### Chunking & Slicing:
- Standard chunk size: **16,384 bytes (16 KB)**.
- Prevents WebRTC SCTP buffer overflow and handles large activation tensors reliably across mobile browser implementations.
- Chunks are assembled sequentially; once all chunks arrive, the tensor is reassembled into a `Float32Array` view and fed to the local ONNX inference session.

---

## 3. Signaling Message Protocol

All signaling events use structured JSON payloads:

### `createSession`
```json
{
  "maxDevices": 4
}
// Ack: { "sessionId": "SI-XXXX", "deviceId": "socket-id" }
```

### `joinSession`
```json
{
  "sessionId": "SI-XXXX"
}
// Ack: { "ok": true, "deviceId": "socket-id", "stageIndex": 1 }
```

### `capabilities`
```json
{
  "sessionId": "SI-XXXX",
  "caps": {
    "cpuCores": 8,
    "platform": "iPhone",
    "userAgent": "Mozilla/5.0 ...",
    "estimatedMemoryGb": 4,
    "supportsWasm": true,
    "supportsWebGpu": false
  }
}
```

### `sdpOffer` / `sdpAnswer`
```json
{
  "to": "target-socket-id",
  "sessionId": "SI-XXXX",
  "sdp": {
    "type": "offer",
    "sdp": "v=0\r\no=- ..."
  }
}
```

### `iceCandidate`
```json
{
  "to": "target-socket-id",
  "sessionId": "SI-XXXX",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```
