// apps/web/src/tests/modelManifest.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Model Manifest & ONNX Stage Partition Integrity', () => {
  const manifestPath = path.resolve(__dirname, '../../public/models/manifest.json');

  it('contains valid manifest structure', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(content.modelName).toBe('SplitInfer-TinyTransformer');
    expect(content.vocabSize).toBe(96);
    expect(content.hiddenDim).toBe(64);
    expect(content.numHeads).toBe(4);
    expect(content.contextLen).toBe(64);
    expect(content.numLayers).toBe(4);
    expect(content.stages.length).toBe(4);
  });

  it('guarantees sequential stage tensor contract (input_shape == previous output_shape)', () => {
    const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const stages = content.stages;

    // Stage 0: [1, 64] -> [1, 64, 64]
    expect(stages[0].inputShape).toEqual([1, 64]);
    expect(stages[0].outputShape).toEqual([1, 64, 64]);

    // Stage 1: [1, 64, 64] -> [1, 64, 64]
    expect(stages[1].inputShape).toEqual(stages[0].outputShape);
    expect(stages[1].outputShape).toEqual([1, 64, 64]);

    // Stage 2: [1, 64, 64] -> [1, 64, 64]
    expect(stages[2].inputShape).toEqual(stages[1].outputShape);
    expect(stages[2].outputShape).toEqual([1, 64, 64]);

    // Stage 3: [1, 64, 64] -> [1, 64, 96]
    expect(stages[3].inputShape).toEqual(stages[2].outputShape);
    expect(stages[3].outputShape).toEqual([1, 64, 96]);
  });

  it('verifies all 4 ONNX stage files exist on disk with non-zero size', () => {
    const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    for (const st of content.stages) {
      const filePath = path.resolve(__dirname, '../../public/models', st.file);
      expect(fs.existsSync(filePath)).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(1024); // More than 1 KB
    }
  });
});
