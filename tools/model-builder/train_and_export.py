#!/usr/bin/env python3
"""
SplitInfer Model Builder
========================
Trains a small character-level decoder-only Transformer,
exports the full model to ONNX, then partitions it into
separate per-stage ONNX files for distributed browser execution.

Configuration:
  - 4 Transformer blocks (one per device)
  - hidden_dim = 64
  - num_heads   = 4
  - context_len = 64
  - vocab       = 96 printable ASCII characters (32-127)

Usage:
  pip install torch onnx onnxruntime numpy
  python train_and_export.py
"""

import json
import os
import hashlib
import string
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import onnx
import onnxruntime as ort

# ── Hyper-parameters ──────────────────────────────────────────────────────────
VOCAB_CHARS = [chr(i) for i in range(32, 128)]  # 96 printable ASCII chars
VOCAB_SIZE   = len(VOCAB_CHARS)                   # 96
HIDDEN_DIM   = 64
NUM_HEADS    = 4
NUM_LAYERS   = 4
CONTEXT_LEN  = 64
DROPOUT      = 0.1
BATCH_SIZE   = 32
EPOCHS       = 200
LR           = 3e-4
SEED         = 42
OUTPUT_DIR   = os.path.join(os.path.dirname(__file__), '../../apps/web/public/models')

torch.manual_seed(SEED)
np.random.seed(SEED)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Vocabulary ────────────────────────────────────────────────────────────────
char_to_idx = {c: i for i, c in enumerate(VOCAB_CHARS)}
idx_to_char = {i: c for i, c in enumerate(VOCAB_CHARS)}

def tokenize(text: str) -> list[int]:
    return [char_to_idx.get(c, 0) for c in text]

def detokenize(ids: list[int]) -> str:
    return ''.join(idx_to_char.get(i, '?') for i in ids)

# ── Training corpus ───────────────────────────────────────────────────────────
CORPUS = """To be or not to be that is the question
Whether tis nobler in the mind to suffer
The slings and arrows of outrageous fortune
Or to take arms against a sea of troubles
And by opposing end them to die to sleep
No more and by a sleep to say we end
The heartache and the thousand natural shocks
That flesh is heir to tis a consummation
Devoutly to be wished to die to sleep
To sleep perchance to dream ay there is the rub
For in that sleep of death what dreams may come
When we have shuffled off this mortal coil
Must give us pause there is the respect
That makes calamity of so long life
For who would bear the whips and scorns of time
The wronger wrong the proud man contumely
The pangs of disprized love the laws delay
The insolence of office and the spurns
That patient merit of the unworthy takes
When he himself might his quietus make
With a bare bodkin who would fardels bear
To grunt and sweat under a weary life
But that the dread of something after death
The undiscovered country from whose bourn
No traveler returns puzzles the will
And makes us rather bear those ills we have
Than fly to others that we know not of
Thus conscience does make cowards of us all
And thus the native hue of resolution
Is sicklied over with the pale cast of thought
And enterprises of great pitch and moment
With this regard their currents turn awry
And lose the name of action""".lower()

# Filter to vocab
CORPUS = ''.join(c if c in char_to_idx else ' ' for c in CORPUS)

# ── Dataset ───────────────────────────────────────────────────────────────────
def make_dataset(text: str, context_len: int):
    ids = tokenize(text)
    xs, ys = [], []
    for i in range(len(ids) - context_len):
        xs.append(ids[i:i+context_len])
        ys.append(ids[i+1:i+context_len+1])
    return torch.tensor(xs, dtype=torch.long), torch.tensor(ys, dtype=torch.long)

# ── Model architecture ────────────────────────────────────────────────────────
class CausalSelfAttention(nn.Module):
    def __init__(self, hidden_dim: int, num_heads: int):
        super().__init__()
        assert hidden_dim % num_heads == 0
        self.num_heads = num_heads
        self.head_dim  = hidden_dim // num_heads
        self.qkv = nn.Linear(hidden_dim, 3 * hidden_dim, bias=False)
        self.out = nn.Linear(hidden_dim, hidden_dim, bias=False)
        # Causal mask
        self.register_buffer('mask', torch.tril(torch.ones(CONTEXT_LEN, CONTEXT_LEN)).view(1,1,CONTEXT_LEN,CONTEXT_LEN))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.shape
        qkv = self.qkv(x).reshape(B, T, 3, self.num_heads, self.head_dim).permute(2, 0, 3, 1, 4)
        q, k, v = qkv[0], qkv[1], qkv[2]
        att = (q @ k.transpose(-2, -1)) / (self.head_dim ** 0.5)
        att = att.masked_fill(self.mask[:, :, :T, :T] == 0, float('-inf'))
        att = F.softmax(att, dim=-1)
        y = (att @ v).transpose(1, 2).contiguous().reshape(B, T, C)
        return self.out(y)

class TransformerBlock(nn.Module):
    def __init__(self, hidden_dim: int, num_heads: int):
        super().__init__()
        self.ln1  = nn.LayerNorm(hidden_dim)
        self.attn = CausalSelfAttention(hidden_dim, num_heads)
        self.ln2  = nn.LayerNorm(hidden_dim)
        self.ff   = nn.Sequential(
            nn.Linear(hidden_dim, 4 * hidden_dim),
            nn.GELU(),
            nn.Linear(4 * hidden_dim, hidden_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.ln1(x))
        x = x + self.ff(self.ln2(x))
        return x

class TinyTransformer(nn.Module):
    """Full 4-layer decoder-only transformer."""
    def __init__(self):
        super().__init__()
        self.embed     = nn.Embedding(VOCAB_SIZE, HIDDEN_DIM)
        self.pos_embed = nn.Embedding(CONTEXT_LEN, HIDDEN_DIM)
        self.blocks    = nn.ModuleList([TransformerBlock(HIDDEN_DIM, NUM_HEADS) for _ in range(NUM_LAYERS)])
        self.ln_f      = nn.LayerNorm(HIDDEN_DIM)
        self.head      = nn.Linear(HIDDEN_DIM, VOCAB_SIZE, bias=False)
        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, (nn.Linear, nn.Embedding)):
                nn.init.normal_(m.weight, std=0.02)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T = x.shape
        pos = torch.arange(T, device=x.device).unsqueeze(0)
        h = self.embed(x) + self.pos_embed(pos)
        for block in self.blocks:
            h = block(h)
        h = self.ln_f(h)
        return self.head(h)  # (B, T, vocab_size)

# ── Training ──────────────────────────────────────────────────────────────────
def train():
    print("Training TinyTransformer…")
    X, Y = make_dataset(CORPUS, CONTEXT_LEN)
    model = TinyTransformer()
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-2)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    n = len(X)
    for epoch in range(EPOCHS):
        idx = torch.randperm(n)[:BATCH_SIZE]
        xb, yb = X[idx], Y[idx]
        logits = model(xb)
        loss = F.cross_entropy(logits.view(-1, VOCAB_SIZE), yb.view(-1))
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        scheduler.step()
        if (epoch + 1) % 50 == 0:
            print(f"  Epoch {epoch+1:4d}/{EPOCHS}  loss={loss.item():.4f}")

    print("Training complete.")
    torch.save(model.state_dict(), os.path.join(OUTPUT_DIR, 'model.pt'))
    return model

# ── Stage wrapper models for ONNX export ─────────────────────────────────────
class Stage0Model(nn.Module):
    """Embedding + block 0 → hidden state"""
    def __init__(self, full: TinyTransformer):
        super().__init__()
        self.embed     = full.embed
        self.pos_embed = full.pos_embed
        self.block     = full.blocks[0]

    def forward(self, token_ids: torch.Tensor) -> torch.Tensor:
        B, T = token_ids.shape
        pos = torch.arange(T, device=token_ids.device).unsqueeze(0)
        h = self.embed(token_ids) + self.pos_embed(pos)
        return self.block(h)

class StageMidModel(nn.Module):
    """Single transformer block: hidden → hidden"""
    def __init__(self, block: TransformerBlock):
        super().__init__()
        self.block = block

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        return self.block(hidden)

class Stage3Model(nn.Module):
    """Block 3 + LN + head → logits"""
    def __init__(self, full: TinyTransformer):
        super().__init__()
        self.block = full.blocks[3]
        self.ln_f  = full.ln_f
        self.head  = full.head

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        h = self.block(hidden)
        h = self.ln_f(h)
        return self.head(h)  # (B, T, vocab_size)

# ── ONNX export helpers ───────────────────────────────────────────────────────
def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            h.update(chunk)
    return h.hexdigest()

def export_stage(model: nn.Module, dummy_input, input_names: list[str], output_names: list[str],
                 dynamic_axes: dict, fname: str) -> str:
    path = os.path.join(OUTPUT_DIR, fname)
    model.eval()
    torch.onnx.export(
        model,
        dummy_input,
        path,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        opset_version=18,
        do_constant_folding=True,
    )
    # Ensure weights are self-contained (no external .onnx.data) for browser onnxruntime-web
    m = onnx.load(path, load_external_data=True)
    onnx.save(m, path, save_as_external_data=False)
    data_file = path + '.data'
    if os.path.exists(data_file):
        os.remove(data_file)
    # Verify
    sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    print(f"  ✓ Exported and verified: {fname}")
    return path

def validate_chain(model: TinyTransformer, token_ids: torch.Tensor) -> bool:
    """Validate that partitioned ONNX stages produce the same output as the full model."""
    print("\nValidating stage outputs against full model…")
    model.eval()

    with torch.no_grad():
        full_logits = model(token_ids).numpy()

    ids_np = token_ids.numpy().astype(np.int64)
    providers = ['CPUExecutionProvider']

    # Stage 0
    s0 = ort.InferenceSession(os.path.join(OUTPUT_DIR, 'stage-0.onnx'), providers=providers)
    h0 = s0.run(None, {'token_ids': ids_np})[0]

    # Stage 1
    s1 = ort.InferenceSession(os.path.join(OUTPUT_DIR, 'stage-1.onnx'), providers=providers)
    h1 = s1.run(None, {'hidden_in': h0})[0]

    # Stage 2
    s2 = ort.InferenceSession(os.path.join(OUTPUT_DIR, 'stage-2.onnx'), providers=providers)
    h2 = s2.run(None, {'hidden_in': h1})[0]

    # Stage 3
    s3 = ort.InferenceSession(os.path.join(OUTPUT_DIR, 'stage-3.onnx'), providers=providers)
    logits = s3.run(None, {'hidden_in': h2})[0]

    max_diff = np.abs(logits - full_logits).max()
    print(f"  Max absolute difference: {max_diff:.2e}")
    passed = max_diff < 1e-4
    print(f"  Validation: {'PASSED ✓' if passed else 'FAILED ✗'}")
    return passed

# ── Main export routine ───────────────────────────────────────────────────────
def export_all(model: TinyTransformer) -> dict:
    model.eval()
    B, T = 1, CONTEXT_LEN
    dummy_ids    = torch.zeros(B, T, dtype=torch.long)
    dummy_hidden = torch.zeros(B, T, HIDDEN_DIM, dtype=torch.float32)

    print("\nExporting ONNX stages…")

    # Stage 0: token_ids → hidden_out
    export_stage(
        Stage0Model(model),
        (dummy_ids,),
        ['token_ids'],
        ['hidden_out'],
        {'token_ids': {0: 'batch', 1: 'seq'}, 'hidden_out': {0: 'batch', 1: 'seq'}},
        'stage-0.onnx',
    )

    # Stage 1: hidden_in → hidden_out
    export_stage(
        StageMidModel(model.blocks[1]),
        (dummy_hidden,),
        ['hidden_in'],
        ['hidden_out'],
        {'hidden_in': {0: 'batch', 1: 'seq'}, 'hidden_out': {0: 'batch', 1: 'seq'}},
        'stage-1.onnx',
    )

    # Stage 2: hidden_in → hidden_out
    export_stage(
        StageMidModel(model.blocks[2]),
        (dummy_hidden,),
        ['hidden_in'],
        ['hidden_out'],
        {'hidden_in': {0: 'batch', 1: 'seq'}, 'hidden_out': {0: 'batch', 1: 'seq'}},
        'stage-2.onnx',
    )

    # Stage 3: hidden_in → logits
    export_stage(
        Stage3Model(model),
        (dummy_hidden,),
        ['hidden_in'],
        ['logits'],
        {'hidden_in': {0: 'batch', 1: 'seq'}, 'logits': {0: 'batch', 1: 'seq'}},
        'stage-3.onnx',
    )

    # Stage shapes and manifest
    stages = [
        {
            'stageIndex': 0,
            'file': 'stage-0.onnx',
            'inputName': 'token_ids',
            'outputName': 'hidden_out',
            'inputShape': [1, CONTEXT_LEN],
            'outputShape': [1, CONTEXT_LEN, HIDDEN_DIM],
            'sha256': sha256_file(os.path.join(OUTPUT_DIR, 'stage-0.onnx')),
        },
        {
            'stageIndex': 1,
            'file': 'stage-1.onnx',
            'inputName': 'hidden_in',
            'outputName': 'hidden_out',
            'inputShape': [1, CONTEXT_LEN, HIDDEN_DIM],
            'outputShape': [1, CONTEXT_LEN, HIDDEN_DIM],
            'sha256': sha256_file(os.path.join(OUTPUT_DIR, 'stage-1.onnx')),
        },
        {
            'stageIndex': 2,
            'file': 'stage-2.onnx',
            'inputName': 'hidden_in',
            'outputName': 'hidden_out',
            'inputShape': [1, CONTEXT_LEN, HIDDEN_DIM],
            'outputShape': [1, CONTEXT_LEN, HIDDEN_DIM],
            'sha256': sha256_file(os.path.join(OUTPUT_DIR, 'stage-2.onnx')),
        },
        {
            'stageIndex': 3,
            'file': 'stage-3.onnx',
            'inputName': 'hidden_in',
            'outputName': 'logits',
            'inputShape': [1, CONTEXT_LEN, HIDDEN_DIM],
            'outputShape': [1, CONTEXT_LEN, VOCAB_SIZE],
            'sha256': sha256_file(os.path.join(OUTPUT_DIR, 'stage-3.onnx')),
        },
    ]

    import datetime
    manifest = {
        'modelName': 'SplitInfer-TinyTransformer',
        'vocabSize': VOCAB_SIZE,
        'hiddenDim': HIDDEN_DIM,
        'numHeads': NUM_HEADS,
        'contextLen': CONTEXT_LEN,
        'numLayers': NUM_LAYERS,
        'stages': stages,
        'vocab': char_to_idx,
        'vocabInv': {str(v): k for k, v in char_to_idx.items()},
        'createdAt': datetime.datetime.utcnow().isoformat() + 'Z',
    }

    manifest_path = os.path.join(OUTPUT_DIR, 'manifest.json')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"\n✓ Manifest written: {manifest_path}")
    return manifest

# ── Generate text sample ──────────────────────────────────────────────────────
def generate_sample(model: TinyTransformer, prompt: str = "to be or", max_tokens: int = 80) -> str:
    model.eval()
    ids = tokenize(prompt)[-CONTEXT_LEN:]
    with torch.no_grad():
        for _ in range(max_tokens):
            context = torch.tensor([ids[-CONTEXT_LEN:]], dtype=torch.long)
            logits = model(context)[0, -1, :]  # last position
            probs = F.softmax(logits / 0.8, dim=-1)
            next_id = torch.multinomial(probs, 1).item()
            ids.append(int(next_id))
    return detokenize(ids)

# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    model = train()

    print("\nSample generation (single device):")
    sample = generate_sample(model)
    print(f"  '{sample[:120]}'")

    export_all(model)

    # Validate chain with a short sequence
    dummy_ids = torch.zeros(1, CONTEXT_LEN, dtype=torch.long)
    validate_chain(model, dummy_ids)

    print("\n✓ Model build complete. Files in:", OUTPUT_DIR)
