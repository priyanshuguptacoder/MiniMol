// src/services/DistributedInference.ts
// Orchestrates distributed transformer inference across connected peers
import { signalingClient } from './SignalingClient';
import type { PeerManager } from './PeerManager';
import { runStageAtIndex, isStageLoaded } from './InferenceEngine';
import { useInferenceStore } from '../stores/useInferenceStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useHistoryStore } from '../stores/useHistoryStore';
import { useNetworkStore } from '../stores/useNetworkStore';

export class DistributedInference {
  private peerManager: PeerManager | null;
  private cancelled = false;

  // Promise resolvers for receiving tensors from previous stage
  private tensorResolvers: Map<number, (t: Float32Array) => void> = new Map();

  constructor(peerManager: PeerManager | null = null) {
    this.peerManager = peerManager;
  }

  /**
   * Called when this device receives a tensor from another device via WebRTC DataChannel.
   */
  onTensorReceived(stageIndex: number, tensor: Float32Array): void {
    const resolve = this.tensorResolvers.get(stageIndex);
    if (resolve) {
      resolve(tensor);
      this.tensorResolvers.delete(stageIndex);
    }
  }

  private waitForTensor(stageIndex: number, timeoutMs = 30_000): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.tensorResolvers.delete(stageIndex);
        reject(new Error(`Timeout waiting for tensor at stage ${stageIndex}`));
      }, timeoutMs);
      this.tensorResolvers.set(stageIndex, (t) => {
        clearTimeout(timer);
        resolve(t);
      });
    });
  }

  async run(prompt: string): Promise<void> {
    this.cancelled = false;
    const inferStore = useInferenceStore.getState();
    const sessionStore = useSessionStore.getState();
    inferStore.startRun(prompt);

    const { myStageIndex, totalDevices, devices, sessionId } = sessionStore;
    const isSingleDevice = !sessionId || devices.length <= 1 || !this.peerManager;

    const startMs = Date.now();
    inferStore.appendLog(
      isSingleDevice
        ? 'Mode: Standalone / Single Device (Sequential 4-Stage Execution)'
        : `Mode: Distributed across ${devices.length} connected devices (Stage ${myStageIndex})`
    );

    try {
      for (let tokenStep = 0; tokenStep < inferStore.maxTokens; tokenStep++) {
        if (this.cancelled) break;

        const currentText = prompt + inferStore.outputTokens.join('');
        const tokenIds = this.tokenizeToContext(currentText);

        if (isSingleDevice) {
          // ── Single device pipeline execution (all stages 0..3 locally) ──
          const stepStart = Date.now();

          // Stage 0: Embed + Block 1
          const h0 = await runStageAtIndex(0, tokenIds, [1, 64]);
          // Stage 1: Block 2
          const h1 = await runStageAtIndex(1, h0, [1, 64, 64]);
          // Stage 2: Block 3
          const h2 = await runStageAtIndex(2, h1, [1, 64, 64]);
          // Stage 3: Block 4 + Head
          const logits = await runStageAtIndex(3, h2, [1, 64, 64]);

          // Sample token from the last position's logits (position 63)
          const lastLogits = logits.subarray((64 - 1) * 96, 64 * 96);
          const nextChar = this.sampleToken(lastLogits, inferStore.temperature);

          inferStore.appendToken(nextChar);
          const stepMs = Date.now() - stepStart;
          inferStore.appendLog(`Step ${tokenStep + 1}: Generated '${nextChar === '\n' ? '\\n' : nextChar}' (${stepMs}ms)`);

          if (nextChar === '\n' && tokenStep > 4) break;

        } else {
          // ── Distributed pipeline execution across peers ──
          if (!this.peerManager) throw new Error('PeerManager not initialized for distributed execution');

          if (myStageIndex === 0) {
            // Stage 0 initiates forward pass
            inferStore.updateStageLog(0, {
              stageIndex: 0,
              deviceId: sessionStore.myDeviceId ?? '',
              startMs: Date.now(),
              endMs: null,
              durationMs: null,
              bytesTransferred: 0,
            });

            const t0 = Date.now();
            const h0 = await runStageAtIndex(0, tokenIds, [1, 64]);
            const duration = Date.now() - t0;
            inferStore.updateStageLog(0, { endMs: Date.now(), durationMs: duration, bytesTransferred: h0.byteLength });

            // Forward hidden activation to Stage 1 device
            const nextDevice = devices.find(d => d.stageIndex === 1);
            if (!nextDevice) throw new Error('No device assigned to stage 1');
            this.peerManager.sendTensor(nextDevice.socketId, 1, h0);

            // Wait for generated token returned by the final stage
            const tokenTensor = await this.waitForTensor(0);
            const nextChar = String.fromCharCode(Math.round(tokenTensor[0]));
            inferStore.appendToken(nextChar);
            inferStore.appendLog(`Step ${tokenStep + 1}: Received '${nextChar}'`);

            if (nextChar === '\n' && tokenStep > 4) break;

          } else {
            // Intermediate or final stage device: wait for activations from previous stage
            const incoming = await this.waitForTensor(myStageIndex);

            inferStore.updateStageLog(myStageIndex, {
              stageIndex: myStageIndex,
              deviceId: sessionStore.myDeviceId ?? '',
              startMs: Date.now(),
              endMs: null,
              durationMs: null,
              bytesTransferred: incoming.byteLength,
            });

            const tStart = Date.now();
            const output = await runStageAtIndex(myStageIndex, incoming, [1, 64, 64]);
            const duration = Date.now() - tStart;
            inferStore.updateStageLog(myStageIndex, { endMs: Date.now(), durationMs: duration });

            const isLastStage = myStageIndex === (totalDevices - 1);
            if (isLastStage) {
              // Final stage: sample token from output logits
              const lastLogits = output.subarray((64 - 1) * 96, 64 * 96);
              const nextChar = this.sampleToken(lastLogits, inferStore.temperature);
              inferStore.appendToken(nextChar);

              // Send token back to Stage 0 host
              const stage0Device = devices.find(d => d.stageIndex === 0);
              if (stage0Device) {
                const tokenTensor = new Float32Array([nextChar.charCodeAt(0)]);
                this.peerManager.sendTensor(stage0Device.socketId, 0, tokenTensor);
              }
              if (nextChar === '\n' && tokenStep > 4) break;
            } else {
              // Forward to next stage in pipeline
              const nextDevice = devices.find(d => d.stageIndex === myStageIndex + 1);
              if (!nextDevice) throw new Error(`No device assigned to stage ${myStageIndex + 1}`);
              this.peerManager.sendTensor(nextDevice.socketId, myStageIndex + 1, output);
            }
          }
        }
      }

      if (!this.cancelled) {
        const totalMs = Date.now() - startMs;
        const output = inferStore.outputTokens.join('');
        inferStore.completeRun(output, { totalMs });
        inferStore.appendLog(`Inference finished: ${inferStore.outputTokens.length} tokens in ${totalMs}ms`);

        if (sessionId) {
          signalingClient.reportInferenceComplete(sessionId, output, {
            totalMs,
            tokenCount: inferStore.outputTokens.length,
          });
        }

        const networkState = useNetworkStore.getState();
        useHistoryStore.getState().addRecord({
          id: crypto.randomUUID(),
          sessionId: sessionId ?? 'standalone',
          prompt,
          output,
          deviceCount: isSingleDevice ? 1 : totalDevices,
          totalMs,
          tokenCount: inferStore.outputTokens.length,
          bytesTransferred: networkState.totalBytesSent + networkState.totalBytesReceived,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      if (!this.cancelled) {
        inferStore.setError(String(err));
      }
    }
  }

  cancel(): void {
    this.cancelled = true;
    useInferenceStore.getState().cancelRun();
  }

  /**
   * Character-level tokenizer mapped to the 96 ASCII printable chars (32..127).
   * Formats into a fixed context length of 64 using BigInt64Array for ONNX.
   */
  private tokenizeToContext(text: string): BigInt64Array {
    const rawIds = Array.from(text).map(c => {
      const code = c.charCodeAt(0);
      return (code >= 32 && code < 128) ? BigInt(code - 32) : BigInt(0);
    });

    const context = new BigInt64Array(64);
    const slice = rawIds.slice(-64);
    const offset = 64 - slice.length;
    for (let i = 0; i < slice.length; i++) {
      context[offset + i] = slice[i];
    }
    return context;
  }

  /**
   * Temperature-based or greedy sampling over the vocabulary dimension (96).
   */
  private sampleToken(logits: Float32Array, temperature: number): string {
    const vocabSize = 96;
    if (temperature <= 0.05) {
      let maxIdx = 0;
      let maxVal = logits[0];
      for (let i = 1; i < vocabSize; i++) {
        if (logits[i] > maxVal) {
          maxVal = logits[i];
          maxIdx = i;
        }
      }
      return String.fromCharCode(maxIdx + 32);
    }

    const scaled = new Float32Array(vocabSize);
    for (let i = 0; i < vocabSize; i++) scaled[i] = logits[i] / temperature;

    const maxVal = Math.max(...scaled);
    let sumExp = 0;
    const probs = new Float32Array(vocabSize);
    for (let i = 0; i < vocabSize; i++) {
      probs[i] = Math.exp(scaled[i] - maxVal);
      sumExp += probs[i];
    }
    for (let i = 0; i < vocabSize; i++) probs[i] /= sumExp;

    let r = Math.random();
    for (let i = 0; i < vocabSize; i++) {
      r -= probs[i];
      if (r <= 0) return String.fromCharCode(i + 32);
    }
    return String.fromCharCode(vocabSize - 1 + 32);
  }
}
