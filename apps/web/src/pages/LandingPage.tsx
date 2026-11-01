// src/pages/LandingPage.tsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Cpu,
  Smartphone,
  Laptop,
  Share2,
  ShieldCheck,
  Zap,
  Network,
  Layers,
  Activity,
  CheckCircle2,
  Lock,
  Boxes
} from 'lucide-react';

const devices = [
  {
    name: 'Device A (Host Laptop)',
    type: 'laptop',
    icon: Laptop,
    stage: 'Stage 0: Input & Block 1',
    layers: 'Tokenization + Embedding + Positional Encoding + Transformer Block 1',
    output: 'Hidden State Vector [1, 64, 64]',
    color: 'border-blue-500/40 bg-blue-500/5',
    accent: 'text-blue-400',
  },
  {
    name: 'Device B (Phone 1)',
    type: 'phone',
    icon: Smartphone,
    stage: 'Stage 1: Block 2',
    layers: 'Self-Attention + LayerNorm + MLP Feed-Forward (Block 2)',
    output: 'Hidden State Vector [1, 64, 64]',
    color: 'border-cyan-500/40 bg-cyan-500/5',
    accent: 'text-cyan-400',
  },
  {
    name: 'Device C (Phone 2)',
    type: 'phone',
    icon: Smartphone,
    stage: 'Stage 2: Block 3',
    layers: 'Self-Attention + LayerNorm + MLP Feed-Forward (Block 3)',
    output: 'Hidden State Vector [1, 64, 64]',
    color: 'border-indigo-500/40 bg-indigo-500/5',
    accent: 'text-indigo-400',
  },
  {
    name: 'Device D (Phone 3 / Tablet)',
    type: 'phone',
    icon: Smartphone,
    stage: 'Stage 3: Block 4 & Logits',
    layers: 'Transformer Block 4 + Final LayerNorm + LM Vocabulary Head',
    output: 'Next-Token Logits [1, 96]',
    color: 'border-emerald-500/40 bg-emerald-500/5',
    accent: 'text-emerald-400',
  },
];

const techStack = [
  { title: 'ONNX Runtime Web', desc: 'Direct browser WASM execution with SIMD acceleration for transformer subgraphs' },
  { title: 'WebRTC DataChannels', desc: 'Zero-relay, direct peer-to-peer binary transfer of raw activation tensors' },
  { title: 'Pipeline Parallelism', desc: 'Partitioned Transformer layers with sequential forward activation forwarding' },
  { title: 'Dynamic Scheduling', desc: 'Hardware capability probing allocating layers to devices based on compute capacity' },
];

export default function LandingPage() {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-16">
      {/* Hero Section */}
      <section className="text-center space-y-6 pt-6">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-mono font-medium tracking-wide uppercase"
        >
          <Zap size={14} className="animate-pulse" />
          Decentralized Browser-Native AI
        </motion.div>

        <motion.h1
          className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-text-primary max-w-4xl mx-auto"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          One Model. Many Devices.{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent via-cyan-400 to-blue-300">
            Zero Centralized GPU.
          </span>
        </motion.h1>

        <motion.p
          className="text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          SplitInfer partitions deep Transformer networks across connected smartphones and laptops.
          Devices compute their assigned blocks locally via WebAssembly and stream intermediate activation tensors directly through encrypted WebRTC DataChannels.
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Link
            to="/sessions/create"
            className="w-full sm:w-auto px-6 py-3.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg shadow-lg shadow-accent/20 flex items-center justify-center gap-2 transition-all transform active:scale-95"
          >
            Create Inference Session <ArrowRight size={18} />
          </Link>
          <Link
            to="/sessions/join"
            className="w-full sm:w-auto px-6 py-3.5 bg-surface hover:bg-surface-secondary border border-border hover:border-border-hover text-text-primary font-medium rounded-lg flex items-center justify-center gap-2 transition-all"
          >
            <Smartphone size={18} className="text-text-secondary" /> Join From Phone
          </Link>
          <Link
            to="/playground"
            className="w-full sm:w-auto px-5 py-3.5 bg-surface-secondary hover:bg-surface-tertiary text-text-secondary hover:text-text-primary text-sm font-medium rounded-lg border border-border/40 transition-all"
          >
            Playground Demo
          </Link>
        </motion.div>
      </section>

      {/* Interactive Illustrative Pipeline Architecture */}
      <section className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-accent mb-1 flex items-center gap-1.5">
              <Network size={14} /> Illustrative Architecture
            </div>
            <h2 className="text-2xl font-bold tracking-tight">4-Device Distributed Transformer Pipeline</h2>
            <p className="text-sm text-text-secondary mt-1">
              Note: This diagram illustrates the architectural partitioning model. Live connected peers appear in the Session & Network views.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-lg border border-border text-xs font-mono">
            <span className="text-text-muted">Simulate Step:</span>
            {[0, 1, 2, 3].map(step => (
              <button
                key={step}
                onClick={() => setActiveStep(step)}
                className={`px-2 py-0.5 rounded transition ${
                  activeStep === step ? 'bg-accent text-white font-semibold' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                S{step}
              </button>
            ))}
          </div>
        </div>

        {/* Pipeline Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {devices.map((dev, idx) => {
            const Icon = dev.icon;
            const isCurrent = activeStep === idx;
            return (
              <motion.div
                key={dev.name}
                className={`relative rounded-xl border p-5 transition-all duration-300 flex flex-col justify-between ${
                  isCurrent ? `${dev.color} ring-1 ring-accent shadow-lg shadow-accent/5` : 'border-border bg-surface'
                }`}
                whileHover={{ y: -2 }}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-text-muted font-medium">STEP {idx + 1} OF 4</span>
                    <Icon size={18} className={dev.accent} />
                  </div>

                  <div>
                    <h3 className="font-semibold text-sm text-text-primary">{dev.name}</h3>
                    <p className={`text-xs font-mono font-medium mt-0.5 ${dev.accent}`}>{dev.stage}</p>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed bg-surface-secondary/70 p-2.5 rounded border border-border/40">
                    {dev.layers}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-border/40">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted block">Output Tensor:</span>
                  <span className="text-xs font-mono text-text-primary font-medium mt-0.5 block truncate">
                    {dev.output}
                  </span>
                  {idx < 3 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted font-mono">
                      <Share2 size={11} className="text-accent" /> WebRTC DataChannel →
                    </div>
                  )}
                  {idx === 3 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
                      <CheckCircle2 size={11} /> Autoregressive Token Output
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Core Technology Pillars */}
      <section className="space-y-6">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">How SplitInfer Works</h2>
          <p className="text-sm text-text-secondary">
            Engineered to overcome client-side memory constraints and centralized infrastructure costs.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {techStack.map((item, idx) => (
            <div key={idx} className="p-5 rounded-xl bg-surface border border-border space-y-2.5">
              <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center text-accent">
                {idx === 0 && <Cpu size={18} />}
                {idx === 1 && <Share2 size={18} />}
                {idx === 2 && <Layers size={18} />}
                {idx === 3 && <Activity size={18} />}
              </div>
              <h3 className="font-semibold text-sm text-text-primary">{item.title}</h3>
              <p className="text-xs text-text-secondary leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Security & Architecture Highlights */}
      <section className="p-6 rounded-2xl bg-gradient-to-b from-surface to-surface-secondary border border-border grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="flex gap-4 items-start">
          <div className="p-2.5 rounded-lg bg-surface border border-border text-accent shrink-0">
            <Lock size={20} />
          </div>
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">Direct Peer Privacy</h4>
            <p className="text-xs text-text-secondary leading-relaxed">
              Inference activation tensors are transmitted directly peer-to-peer via DTLS/SCTP. The signaling server never sees or relays your model weights or tensors.
            </p>
          </div>
        </div>

        <div className="flex gap-4 items-start">
          <div className="p-2.5 rounded-lg bg-surface border border-border text-emerald-400 shrink-0">
            <ShieldCheck size={20} />
          </div>
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">WASM Memory Isolation</h4>
            <p className="text-xs text-text-secondary leading-relaxed">
              Every stage executes in a sandboxed WebAssembly runtime with isolated memory bounds, SIMD vectorization, and zero native plugin requirements.
            </p>
          </div>
        </div>

        <div className="flex gap-4 items-start">
          <div className="p-2.5 rounded-lg bg-surface border border-border text-cyan-400 shrink-0">
            <Boxes size={20} />
          </div>
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">Zero Server GPU Bill</h4>
            <p className="text-xs text-text-secondary leading-relaxed">
              Aggregate computing power from everyday devices you already own. Transform consumer phones into a distributed edge inference cluster.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
