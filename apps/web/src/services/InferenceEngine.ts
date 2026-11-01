// src/services/InferenceEngine.ts
// Loads and executes ONNX stage partitions using ONNX Runtime Web (WASM)
import * as ort from 'onnxruntime-web';

export interface StageSession {
  session: ort.InferenceSession;
  inputName: string;
  outputName: string;
  stageIndex: number;
}

const stageSessions = new Map<number, StageSession>();

export async function loadStage(
  stageUrl: string,
  stageIndex: number,
  inputName: string,
  outputName: string,
  backend: 'wasm' | 'webgpu' = 'wasm'
): Promise<void> {
  // Configure WASM backend with multi-threading and SIMD
  ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 1, 4);
  ort.env.wasm.simd = true;

  const opts: ort.InferenceSession.SessionOptions = {
    executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
  };

  const session = await ort.InferenceSession.create(stageUrl, opts);
  stageSessions.set(stageIndex, { session, inputName, outputName, stageIndex });
}

export async function runStageAtIndex(
  stageIndex: number,
  inputData: Float32Array | BigInt64Array,
  inputShape: number[]
): Promise<Float32Array> {
  const stage = stageSessions.get(stageIndex);
  if (!stage) throw new Error(`Stage ${stageIndex} not loaded`);
  const { session, inputName, outputName } = stage;

  const tensorType = stageIndex === 0 ? 'int64' : 'float32';
  const tensor = new ort.Tensor(tensorType, inputData as any, inputShape);
  const feeds: Record<string, ort.Tensor> = { [inputName]: tensor };
  const results = await session.run(feeds);
  const output = results[outputName];
  if (!output) throw new Error(`Output '${outputName}' not found in model results`);
  return output.data as Float32Array;
}

export async function runStage(
  inputData: Float32Array | BigInt64Array,
  inputShape: number[]
): Promise<Float32Array> {
  const first = stageSessions.values().next().value;
  if (!first) throw new Error('No stage loaded');
  return runStageAtIndex(first.stageIndex, inputData, inputShape);
}

export function isStageLoaded(stageIndex?: number): boolean {
  if (stageIndex !== undefined) return stageSessions.has(stageIndex);
  return stageSessions.size > 0;
}

export function getLoadedStageIndices(): number[] {
  return Array.from(stageSessions.keys());
}
