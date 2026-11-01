// src/pages/PlaygroundPage.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  Loader2,
  Sparkles,
  Layers,
  Terminal,
  Cpu,
  Clock,
  Gauge
} from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useInferenceStore } from '../stores/useInferenceStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useModelStore } from '../stores/useModelStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { PeerManager, getPeerManager, initPeerManager } from '../services/PeerManager';
import { DistributedInference } from '../services/DistributedInference';
import { loadStage, isStageLoaded, getLoadedStageIndices } from '../services/InferenceEngine';

let peerManager: PeerManager | null = null;
let distributedInference: DistributedInference | null = null;
let playgroundTensorUnsub: (() => void) | null = null;

export default function PlaygroundPage() {
  const [prompt, setPrompt] = useState('to be or not to be that is');
  const [showLogs, setShowLogs] = useState(true);
  const [modelReady, setModelReady] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadedStagesList, setLoadedStagesList] = useState<number[]>([]);

  const inference = useInferenceStore();
  const session = useSessionStore();
  const model = useModelStore();
  const settings = useSettingsStore();
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll output container
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [inference.outputTokens]);

  const isSingleDevice = !session.sessionId || session.devices.length <= 1;

  const handleLoadModel = useCallback(async () => {
    setLoadingModel(true);
    setLoadError('');
    try {
      inference.appendLog(`Fetching model manifest from ${settings.manifestUrl}…`);
      const res = await fetch(settings.manifestUrl);
      if (!res.ok) throw new Error(`Manifest fetch failed with status: ${res.status}`);
      const manifest = await res.json();
      model.setManifest(manifest);

      const baseUrl = settings.manifestUrl.substring(0, settings.manifestUrl.lastIndexOf('/') + 1);

      if (isSingleDevice) {
        // Load all 4 stages sequentially for complete standalone demo
        inference.appendLog('Standalone mode detected: Loading all 4 stages (0, 1, 2, 3)…');
        for (const st of manifest.stages) {
          const stageUrl = baseUrl + st.file;
          inference.appendLog(`Loading Stage ${st.stageIndex} (${st.file})…`);
          await loadStage(stageUrl, st.stageIndex, st.inputName, st.outputName, settings.inferenceBackend);
        }
        setLoadedStagesList([0, 1, 2, 3]);
        inference.appendLog('All 4 stages loaded successfully! Ready for local pipeline inference.');
      } else {
        // Multi-device: only load the device's assigned partition
        const myStage = session.myStageIndex;
        const stageInfo = manifest.stages[myStage];
        if (!stageInfo) throw new Error(`No stage descriptor for stage ${myStage}`);
        const stageUrl = baseUrl + stageInfo.file;
        inference.appendLog(`Loading assigned Stage ${myStage} (${stageInfo.file})…`);
        await loadStage(stageUrl, myStage, stageInfo.inputName, stageInfo.outputName, settings.inferenceBackend);
        setLoadedStagesList([myStage]);
        inference.appendLog(`Stage ${myStage} loaded successfully.`);
      }

      model.setMyStageLoaded(true);
      setModelReady(true);
    } catch (e) {
      setLoadError(String(e));
      inference.appendLog(`[ERROR] Model loading failed: ${e}`);
    } finally {
      setLoadingModel(false);
    }
  }, [settings.manifestUrl, settings.inferenceBackend, session.myStageIndex, isSingleDevice, model, inference]);

  const handleStart = async () => {
    if (!prompt.trim()) return;

    // Cancel any previous run
    distributedInference?.cancel();
    if (playgroundTensorUnsub) {
      playgroundTensorUnsub();
      playgroundTensorUnsub = null;
    }

    if (!isSingleDevice && session.sessionId) {
      const pm = getPeerManager() || initPeerManager({
        sessionId: session.sessionId,
        myDeviceId: session.myDeviceId ?? '',
        stunUrls: settings.stunUrls,
        turnUrl: settings.turnUrl || undefined,
        turnUsername: settings.turnUsername || undefined,
        turnCredential: settings.turnCredential || undefined,
        onTensorReceived: (stageIndex, tensor) => {
          distributedInference?.onTensorReceived(stageIndex, tensor);
        },
      });

      peerManager = pm;
      distributedInference = new DistributedInference(peerManager);

      // Register tensor listener (only once, remove previous)
      playgroundTensorUnsub = pm.onTensor((stageIndex, tensor) => {
        distributedInference?.onTensorReceived(stageIndex, tensor);
      });
    } else {
      // Standalone single-device mode
      distributedInference = new DistributedInference(null);
    }

    await distributedInference.run(prompt);
  };

  const handleStop = () => {
    distributedInference?.cancel();
  };

  const isRunning = inference.status === 'running';

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-6">
      {/* Page Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={20} className="text-accent" />
            <h1 className="text-3xl font-bold">Inference Playground</h1>
          </div>
          <p className="text-text-secondary text-sm">
            Execute the 4-layer Transformer model partitioned across local WASM threads and peer devices.
          </p>
        </div>
        <div className="text-right">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium ${
            isSingleDevice ? 'bg-surface-secondary text-text-secondary border border-border' : 'bg-accent/10 text-accent border border-accent/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isSingleDevice ? 'bg-text-muted' : 'bg-accent animate-pulse'}`} />
            {isSingleDevice ? 'Standalone Mode' : `Distributed (${session.devices.length} Peers)`}
          </span>
        </div>
      </motion.div>

      {/* Model Loading Card */}
      {!modelReady ? (
        <motion.div className="p-6 bg-surface border border-border rounded-xl space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Layers size={18} className="text-accent" /> Model Partitions Required
              </h2>
              <p className="text-text-secondary text-xs mt-1">
                {isSingleDevice
                  ? 'Loads all 4 Transformer stages into local browser WASM runtime for standalone execution.'
                  : `Loads your assigned partition (Stage ${session.myStageIndex}) into local WASM runtime.`}
              </p>
            </div>
            <span className="text-xs font-mono text-text-muted bg-surface-secondary px-2.5 py-1 rounded border border-border">
              {settings.inferenceBackend.toUpperCase()} Backend
            </span>
          </div>

          {loadError && (
            <div className="flex items-center gap-2 text-danger text-xs bg-danger/10 border border-danger/20 p-3 rounded-lg">
              <AlertCircle size={16} /> {loadError}
            </div>
          )}

          <Button onClick={handleLoadModel} disabled={loadingModel} className="flex items-center gap-2">
            {loadingModel ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
            {loadingModel ? 'Compiling WASM Modules…' : (isSingleDevice ? 'Load Complete Pipeline (Stages 0-3)' : `Load Stage ${session.myStageIndex}`)}
          </Button>
        </motion.div>
      ) : (
        <div className="flex items-center justify-between p-3.5 bg-surface border border-emerald-500/30 rounded-xl text-xs">
          <div className="flex items-center gap-2 text-emerald-400 font-medium">
            <CheckCircle size={16} />
            <span>
              {isSingleDevice
                ? 'All 4 Pipeline Stages (0, 1, 2, 3) compiled & loaded in WebAssembly runtime'
                : `Assigned Partition (Stage ${session.myStageIndex}) active in WebAssembly runtime`}
            </span>
          </div>
          <span className="text-text-muted font-mono">SIMD Threads: 4</span>
        </div>
      )}

      {/* Prompt Editor & Controls */}
      <div className="p-6 bg-surface border border-border rounded-xl space-y-5">
        <div>
          <label className="text-xs font-mono uppercase tracking-wider text-text-muted block mb-2">Input Prompt</label>
          <textarea
            className="w-full px-4 py-3 bg-surface-secondary border border-border rounded-lg text-text-primary font-mono text-sm resize-none focus:outline-none focus:border-accent h-24 transition"
            placeholder="Type your prompt here…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={isRunning}
          />
        </div>

        {/* Hyperparameter Sliders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Sampling Temperature</span>
              <span className="font-mono text-accent font-semibold">{inference.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={inference.temperature}
              onChange={e => inference.setTemperature(Number(e.target.value))}
              disabled={isRunning}
              className="w-full accent-accent"
            />
            <span className="text-[10px] text-text-muted block">0.0 = Greedy argmax, 0.8 = Creative sampling</span>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Max New Tokens</span>
              <span className="font-mono text-accent font-semibold">{inference.maxTokens}</span>
            </div>
            <input
              type="range"
              min={8}
              max={128}
              step={8}
              value={inference.maxTokens}
              onChange={e => inference.setMaxTokens(Number(e.target.value))}
              disabled={isRunning}
              className="w-full accent-accent"
            />
            <span className="text-[10px] text-text-muted block">Max autoregressive generation steps</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            onClick={handleStart}
            disabled={isRunning || !prompt.trim() || !modelReady}
            className="flex items-center gap-2 px-6"
          >
            {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {isRunning ? 'Streaming Generation…' : 'Run Pipeline Inference'}
          </Button>

          {isRunning && (
            <Button onClick={handleStop} className="flex items-center gap-2 bg-danger/20 text-danger hover:bg-danger/30">
              <Square size={16} /> Stop Execution
            </Button>
          )}
        </div>
      </div>

      {/* Streaming Output Display */}
      {(inference.outputTokens.length > 0 || inference.status !== 'idle') && (
        <motion.div className="p-6 bg-surface border border-border rounded-xl space-y-3" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Terminal size={16} className="text-accent" /> Autoregressive Streamed Output
            </h2>
            {inference.currentRun?.totalMs && (
              <span className="text-xs font-mono text-text-muted">
                {inference.currentRun.tokenCount} tokens in {inference.currentRun.totalMs}ms (
                {( (inference.currentRun.tokenCount / (inference.currentRun.totalMs / 1000)) || 0 ).toFixed(1)} t/s)
              </span>
            )}
          </div>

          <div
            ref={outputRef}
            className="bg-surface-secondary border border-border rounded-lg p-4 font-mono text-sm min-h-28 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text"
          >
            <span className="text-text-muted select-none">{prompt}</span>
            <span className="text-text-primary font-medium">{inference.outputTokens.join('')}</span>
            {isRunning && <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-0.5 align-middle" />}
          </div>

          {inference.status === 'error' && inference.currentRun?.error && (
            <div className="flex items-center gap-2 text-danger text-xs bg-danger/10 p-2.5 rounded border border-danger/20">
              <AlertCircle size={14} /> {inference.currentRun.error}
            </div>
          )}
        </motion.div>
      )}

      {/* Real-Time Execution Logs */}
      <div className="p-6 bg-surface border border-border rounded-xl space-y-3">
        <button
          className="w-full flex items-center justify-between text-xs font-semibold text-text-secondary hover:text-text-primary transition"
          onClick={() => setShowLogs(v => !v)}
        >
          <span className="flex items-center gap-2">
            <Gauge size={14} /> Real-Time Stage Diagnostics ({inference.logs.length} events)
          </span>
          {showLogs ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showLogs && (
          <div className="bg-surface-secondary border border-border rounded-lg p-3.5 font-mono text-xs max-h-52 overflow-y-auto space-y-1">
            {inference.logs.length === 0 ? (
              <p className="text-text-muted">Diagnostics will stream here during forward passes…</p>
            ) : (
              inference.logs.map((log, i) => (
                <div key={i} className="text-text-secondary leading-tight truncate">
                  {log}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
