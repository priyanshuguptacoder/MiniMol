// src/services/DistributedInference.ts
// Orchestrates distributed transformer inference across connected peers
import { signalingClient } from './SignalingClient';
import type { PeerManager } from './PeerManager';
import { runStageAtIndex, isStageLoaded, loadStage } from './InferenceEngine';
import { useInferenceStore } from '../stores/useInferenceStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useHistoryStore } from '../stores/useHistoryStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useModelStore } from '../stores/useModelStore';

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
    } else {
      console.warn(`[DistributedInference] No resolver for stageIndex=${stageIndex}, dropping tensor`);
    }
  }

  private waitForTensor(stageIndex: number, timeoutMs = 60_000): Promise<Float32Array> {
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

  /**
   * Run inference. On Stage 0 (host): orchestrates the full autoregressive loop.
   * On Stage 1+: acts as a compute worker, waiting for activations, processing, forwarding.
   */
  async run(prompt: string): Promise<void> {
    this.cancelled = false;
    const sessionStore = useSessionStore.getState();
    const { myStageIndex, totalDevices, devices, sessionId } = sessionStore;
    const isSingleDevice = !sessionId || devices.length <= 1 || !this.peerManager;

    if (myStageIndex === 0 || isSingleDevice) {
      // ── HOST / Stage-0 path ──
      await this.runHostPipeline(prompt, isSingleDevice, sessionStore);
    } else {
      // ── WORKER / Stage-1+ path ──
      await this.runWorkerLoop(myStageIndex, totalDevices, devices, sessionStore);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HOST (Stage 0) - runs the full autoregressive generation loop
  // ─────────────────────────────────────────────────────────────────────────────
  private async runHostPipeline(
    prompt: string,
    isSingleDevice: boolean,
    sessionStore: ReturnType<typeof useSessionStore.getState>
  ): Promise<void> {
    const inferStore = useInferenceStore.getState();
    const { myStageIndex, totalDevices, devices, sessionId } = sessionStore;
    inferStore.startRun(prompt);

    const startMs = Date.now();
    inferStore.appendLog(
      isSingleDevice
        ? 'Mode: Standalone / Single Device (Sequential 4-Stage Execution)'
        : `Mode: Distributed across ${devices.length} connected devices (Stage 0)`
    );

    try {
      // Signal all peer nodes to start their worker loops (only for distributed)
      if (!isSingleDevice && sessionId) {
        signalingClient.startInference(sessionId, prompt);
        inferStore.appendLog('Broadcasted inferenceStart to all peer compute nodes');
        // Small delay to let phones start their listeners before first tensor arrives
        await new Promise(res => setTimeout(res, 500));
      }

      for (let tokenStep = 0; tokenStep < inferStore.maxTokens; tokenStep++) {
        if (this.cancelled) break;

        const currentText = prompt + inferStore.outputTokens.join('');
        const tokenIds = this.tokenizeToContext(currentText);

        if (isSingleDevice) {
          // ── Standalone: all 4 stages local ──
          const stepStart = Date.now();
          const h0 = await runStageAtIndex(0, tokenIds, [1, 64]);
          const h1 = await runStageAtIndex(1, h0, [1, 64, 64]);
          const h2 = await runStageAtIndex(2, h1, [1, 64, 64]);
          const logits = await runStageAtIndex(3, h2, [1, 64, 64]);

          const lastLogits = logits.subarray((64 - 1) * 96, 64 * 96);
          const nextChar = this.sampleToken(lastLogits, inferStore.temperature);
          inferStore.appendToken(nextChar);
          const stepMs = Date.now() - stepStart;
          inferStore.appendLog(`Step ${tokenStep + 1}: Generated '${nextChar === '\n' ? '\\n' : nextChar}' (${stepMs}ms)`);

          if (nextChar === '\n' && tokenStep > 4) break;
        } else {
          // ── Distributed: Stage 0 runs, sends to Stage 1, waits for token back ──
          if (!this.peerManager) throw new Error('PeerManager not initialized');

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

          // Forward to Stage 1
          const nextDevice = devices.find(d => d.stageIndex === 1);
          if (!nextDevice) throw new Error('No device assigned to stage 1');

          const dc = this.peerManager.getDataChannel(nextDevice.socketId);
          if (!dc || dc.readyState !== 'open') {
            throw new Error(`DataChannel to Stage 1 device (${nextDevice.socketId.slice(0, 8)}) is not open (state: ${dc?.readyState ?? 'missing'}). Ensure all devices are connected before running inference.`);
          }

          this.peerManager.sendTensor(nextDevice.socketId, 1, h0);
          inferStore.appendLog(`Step ${tokenStep + 1}: Sent activation to Stage 1, waiting for token...`);

          // Wait for final stage to send token back to stage 0
          const tokenTensor = await this.waitForTensor(0, 120_000);
          const nextChar = String.fromCharCode(Math.round(tokenTensor[0]));
          inferStore.appendToken(nextChar);
          inferStore.appendLog(`Step ${tokenStep + 1}: Received token '${nextChar === '\n' ? '\\n' : nextChar}'`);

          if (nextChar === '\n' && tokenStep > 4) break;
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
          deviceCount: isSingleDevice ? 1 : useSessionStore.getState().totalDevices,
          totalMs,
          tokenCount: inferStore.outputTokens.length,
          bytesTransferred: networkState.totalBytesSent + networkState.totalBytesReceived,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      if (!this.cancelled) {
        useInferenceStore.getState().setError(String(err));
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WORKER (Stage 1+) - runs until cancelled, processing one tensor per step
  // ─────────────────────────────────────────────────────────────────────────────
  private async runWorkerLoop(
    myStageIndex: number,
    totalDevices: number,
    devices: ReturnType<typeof useSessionStore.getState>['devices'],
    sessionStore: ReturnType<typeof useSessionStore.getState>
  ): Promise<void> {
    // Ensure this stage's model is loaded
    if (!isStageLoaded(myStageIndex)) {
      console.log(`[DistributedInference] Stage ${myStageIndex}: model not loaded, loading now...`);
      try {
        const settings = useSettingsStore.getState();
        const manifest = useModelStore.getState().manifest;
        if (!manifest) throw new Error('Model manifest not loaded on this device. Please load the model first.');

        const baseUrl = settings.manifestUrl.substring(0, settings.manifestUrl.lastIndexOf('/') + 1);
        const stageInfo = manifest.stages[myStageIndex];
        if (!stageInfo) throw new Error(`No stage descriptor for stage ${myStageIndex}`);

        await loadStage(
          baseUrl + stageInfo.file,
          myStageIndex,
          stageInfo.inputName,
          stageInfo.outputName,
          settings.inferenceBackend
        );
        console.log(`[DistributedInference] Stage ${myStageIndex}: model loaded successfully`);
      } catch (err) {
        console.error(`[DistributedInference] Stage ${myStageIndex}: failed to load model:`, err);
        throw err;
      }
    }

    const isLastStage = myStageIndex === (totalDevices - 1);
    console.log(`[DistributedInference] Stage ${myStageIndex} worker started (isLast=${isLastStage})`);

    // Process tokens indefinitely until cancelled
    while (!this.cancelled) {
      try {
        // Wait for activation tensor from previous stage
        const incoming = await this.waitForTensor(myStageIndex, 120_000);
        if (this.cancelled) break;

        const tStart = Date.now();
        const output = await runStageAtIndex(myStageIndex, incoming, [1, 64, 64]);
        const duration = Date.now() - tStart;
        console.log(`[DistributedInference] Stage ${myStageIndex}: processed tensor in ${duration}ms`);

        if (isLastStage) {
          // Sample token from output logits
          const inferStore = useInferenceStore.getState();
          const lastLogits = output.subarray((64 - 1) * 96, 64 * 96);
          const nextChar = this.sampleToken(lastLogits, inferStore.temperature);

          // Send token back to Stage 0
          const stage0Device = devices.find(d => d.stageIndex === 0);
          if (stage0Device && this.peerManager) {
            const dc = this.peerManager.getDataChannel(stage0Device.socketId);
            if (dc && dc.readyState === 'open') {
              const tokenTensor = new Float32Array([nextChar.charCodeAt(0)]);
              this.peerManager.sendTensor(stage0Device.socketId, 0, tokenTensor);
              console.log(`[DistributedInference] Stage ${myStageIndex} (last): sent token '${nextChar}' back to Stage 0`);
            } else {
              // Fallback: send token back through predecessor DataChannel (bidirectional)
              console.warn(`[DistributedInference] No direct DC to Stage 0 — cannot return token`);
            }
          }
        } else {
          // Forward activation to next stage
          const nextDevice = devices.find(d => d.stageIndex === myStageIndex + 1);
          if (!nextDevice) {
            console.error(`[DistributedInference] Stage ${myStageIndex}: No device for stage ${myStageIndex + 1}`);
            continue;
          }
          if (!this.peerManager) continue;

          const dc = this.peerManager.getDataChannel(nextDevice.socketId);
          if (!dc || dc.readyState !== 'open') {
            console.error(`[DistributedInference] Stage ${myStageIndex}: DC to stage ${myStageIndex + 1} not open`);
            continue;
          }
          this.peerManager.sendTensor(nextDevice.socketId, myStageIndex + 1, output);
          console.log(`[DistributedInference] Stage ${myStageIndex}: forwarded activation to Stage ${myStageIndex + 1}`);
        }
      } catch (err) {
        if (this.cancelled) break;
        // Timeout or processing error — log and continue listening for next tensor
        console.error(`[DistributedInference] Stage ${myStageIndex} worker error:`, err);
        break; // Exit worker loop on timeout
      }
    }

    console.log(`[DistributedInference] Stage ${myStageIndex} worker stopped`);
  }

  cancel(): void {
    this.cancelled = true;
    // Reject all pending waitForTensor promises
    for (const [stageIndex, _resolver] of this.tensorResolvers.entries()) {
      this.tensorResolvers.delete(stageIndex);
    }
    this.tensorResolvers.clear();
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
