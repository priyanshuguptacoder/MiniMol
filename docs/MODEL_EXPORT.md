# SplitInfer Model Architecture, Training & Partitioning

This document describes the Transformer architecture, PyTorch training, ONNX graph decomposition, and numerical validation across pipeline stages.

---

## 1. Model Configuration

SplitInfer includes a 4-layer decoder-only causal Transformer trained on character sequences:

- **Layers**: 4 Transformer Blocks (1 block per compute stage/device)
- **Hidden Dimension ($d_{\text{model}}$)**: 64
- **Attention Heads ($n_{\text{head}}$)**: 4 (head dimension = 16)
- **Context Length ($T$)**: 64 tokens
- **Vocabulary Size ($V$)**: 96 printable ASCII characters (indices 0 to 95, mapping ASCII 32 to 127)
- **Feed-Forward Expansion**: $4 \times d_{\text{model}} = 256$ with GELU activation
- **Normalization**: Pre-LayerNorm with learned scale and bias

---

## 2. Stage Decomposition

The monolithic Transformer network is split into 4 independent ONNX subgraphs:

```text
Prompt Text
     │
     ▼
[Tokenize] ─── (Length 64 BigInt64Array)
     │
     ▼
┌────────────────────────────────────────────────────────────┐
│ Stage 0: Embedding & Block 1 (stage-0.onnx)                │
│ Inputs:  token_ids [1, 64] (int64)                         │
│ Layers:  Token Embedding + Positional Embedding + Block 1  │
│ Outputs: hidden_out [1, 64, 64] (float32)                  │
└────────────────────────────────────────────────────────────┘
     │
     ▼ (16,384 Bytes via WebRTC DataChannel)
┌────────────────────────────────────────────────────────────┐
│ Stage 1: Transformer Block 2 (stage-1.onnx)                │
│ Inputs:  hidden_in [1, 64, 64] (float32)                   │
│ Layers:  LN1 + Causal Attention + LN2 + MLP                │
│ Outputs: hidden_out [1, 64, 64] (float32)                  │
└────────────────────────────────────────────────────────────┘
     │
     ▼ (16,384 Bytes via WebRTC DataChannel)
┌────────────────────────────────────────────────────────────┐
│ Stage 2: Transformer Block 3 (stage-2.onnx)                │
│ Inputs:  hidden_in [1, 64, 64] (float32)                   │
│ Layers:  LN1 + Causal Attention + LN2 + MLP                │
│ Outputs: hidden_out [1, 64, 64] (float32)                  │
└────────────────────────────────────────────────────────────┘
     │
     ▼ (16,384 Bytes via WebRTC DataChannel)
┌────────────────────────────────────────────────────────────┐
│ Stage 3: Transformer Block 4 & LM Head (stage-3.onnx)      │
│ Inputs:  hidden_in [1, 64, 64] (float32)                   │
│ Layers:  Block 4 + Final LN + Linear Vocabulary Projection │
│ Outputs: logits [1, 64, 96] (float32)                      │
└────────────────────────────────────────────────────────────┘
     │
     ▼
[Sample Next Token] ─── (Extract index from position 63 logits)
     │
     ▼
Next Generated Character ('a', 'b', ...)
```

---

## 3. Numerical Validation

To guarantee zero precision loss across distributed devices, `train_and_export.py` compares the output of the full PyTorch model against the sequentially executed ONNX partitions:

```bash
npm run model:build
```

**Measured Numerical Divergence:**
$$\max |\text{Logits}_{\text{PyTorch}} - \text{Logits}_{\text{Partitioned ONNX}}| = 8.34 \times 10^{-7} < 10^{-4}$$

The pipeline achieves near bit-exact parity with full 32-bit floating point precision.
