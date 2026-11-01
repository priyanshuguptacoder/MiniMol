// apps/web/src/tests/tensorProtocol.test.ts
import { describe, it, expect } from 'vitest';

describe('WebRTC Binary Tensor Protocol', () => {
  const HEADER_SIZE = 16;

  function encodeTensor(stageIndex: number, tensor: Float32Array, chunkSize = 1024): ArrayBuffer[] {
    const payload = tensor.buffer;
    const totalBytes = payload.byteLength;
    const totalChunks = Math.ceil(totalBytes / chunkSize);
    const frames: ArrayBuffer[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunkStart = i * chunkSize;
      const chunkEnd = Math.min(chunkStart + chunkSize, totalBytes);
      const chunk = payload.slice(chunkStart, chunkEnd);
      const frame = new ArrayBuffer(HEADER_SIZE + chunk.byteLength);
      const view = new DataView(frame);
      view.setUint8(0, 1);                  // version
      view.setUint8(1, 1);                  // type = tensor
      view.setUint16(2, stageIndex, true);   // stageIndex
      view.setUint32(4, totalChunks, true);  // totalChunks
      view.setUint32(8, i, true);            // chunkIndex
      view.setUint32(12, totalBytes, true);  // totalBytes
      new Uint8Array(frame, HEADER_SIZE).set(new Uint8Array(chunk));
      frames.push(frame);
    }
    return frames;
  }

  function decodeFrames(frames: ArrayBuffer[]): { stageIndex: number; tensor: Float32Array } {
    const firstView = new DataView(frames[0]);
    expect(firstView.getUint8(0)).toBe(1); // Version 1
    expect(firstView.getUint8(1)).toBe(1); // Tensor frame
    const stageIndex = firstView.getUint16(2, true);
    const totalChunks = firstView.getUint32(4, true);
    const totalBytes = firstView.getUint32(12, true);

    expect(frames.length).toBe(totalChunks);

    const assembled = new Uint8Array(totalBytes);
    let offset = 0;
    for (let i = 0; i < totalChunks; i++) {
      const view = new DataView(frames[i]);
      expect(view.getUint32(8, true)).toBe(i); // Chunk order
      const chunk = frames[i].slice(HEADER_SIZE);
      assembled.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    expect(offset).toBe(totalBytes);
    return {
      stageIndex,
      tensor: new Float32Array(assembled.buffer),
    };
  }

  it('correctly chunks and reassembles small activation tensors', () => {
    const rawData = new Float32Array([0.1, -0.45, 1.23, 4.56, -0.99, 10.0]);
    const frames = encodeTensor(1, rawData, 8); // Force 8-byte chunks (2 floats per chunk)
    expect(frames.length).toBe(3);

    const { stageIndex, tensor } = decodeFrames(frames);
    expect(stageIndex).toBe(1);
    expect(tensor.length).toBe(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      expect(tensor[i]).toBeCloseTo(rawData[i], 5);
    }
  });

  it('correctly handles hidden state tensors of size [1, 64, 64] (16,384 bytes)', () => {
    const hiddenSize = 64 * 64; // 4096 floats = 16384 bytes
    const hiddenData = new Float32Array(hiddenSize);
    for (let i = 0; i < hiddenSize; i++) {
      hiddenData[i] = Math.sin(i * 0.1);
    }

    const frames = encodeTensor(2, hiddenData, 4096);
    expect(frames.length).toBe(4);

    const { stageIndex, tensor } = decodeFrames(frames);
    expect(stageIndex).toBe(2);
    expect(tensor.length).toBe(hiddenSize);
    expect(tensor[0]).toBeCloseTo(hiddenData[0], 5);
    expect(tensor[1000]).toBeCloseTo(hiddenData[1000], 5);
    expect(tensor[4095]).toBeCloseTo(hiddenData[4095], 5);
  });
});
