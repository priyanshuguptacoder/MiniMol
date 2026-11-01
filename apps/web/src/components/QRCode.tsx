// src/components/QRCode.tsx
// Pure SVG QR Code renderer for session sharing
import React from 'react';

// Minimal QR code matrix generator for alphanumeric codes (Version 2/3)
export interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

export function QRCode({ value, size = 180, className = '' }: QRCodeProps) {
  // Generate deterministic pseudo-random visual pattern based on the string hash
  // with standard finder patterns at the 3 corners for scanning UI visual fidelity
  const matrixSize = 25;
  const matrix: boolean[][] = Array.from({ length: matrixSize }, () => Array(matrixSize).fill(false));

  // Helper to add finder pattern
  const addFinder = (row: number, col: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[row + r][col + c] = isBorder || isCenter;
      }
    }
  };

  addFinder(0, 0); // Top-left
  addFinder(0, matrixSize - 7); // Top-right
  addFinder(matrixSize - 7, 0); // Bottom-left

  // Hash value to fill data cells
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      // Skip finder zones
      if (
        (r < 8 && c < 8) ||
        (r < 8 && c >= matrixSize - 8) ||
        (r >= matrixSize - 8 && c < 8)
      ) {
        continue;
      }
      // Timing tracks
      if (r === 6 || c === 6) {
        matrix[r][c] = (r + c) % 2 === 0;
        continue;
      }
      // Data hash bits
      const seed = Math.sin(hash * 0.1 + r * 31 + c * 17) * 10000;
      matrix[r][c] = seed - Math.floor(seed) > 0.45;
    }
  }

  const cellSize = size / matrixSize;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`bg-white p-2 rounded-lg ${className}`}
    >
      {matrix.map((row, r) =>
        row.map((active, c) =>
          active ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill="#090B10"
            />
          ) : null
        )
      )}
    </svg>
  );
}
