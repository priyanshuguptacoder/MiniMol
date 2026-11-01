#!/usr/bin/env node
// scripts/start-all.js
// Runs both SplitInfer signaling server and frontend concurrently without external dependencies
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('🚀 Starting SplitInfer Cluster (Signaling Server + Frontend)...\n');

const signaling = spawn('npm', ['run', 'dev:server'], {
  cwd: rootDir,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

const frontend = spawn('npm', ['run', 'dev:web'], {
  cwd: rootDir,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

function prefixOutput(stream, prefix, color = '\x1b[36m') {
  stream.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${color}${prefix}\x1b[0m ${line}`);
      }
    }
  });
}

prefixOutput(signaling.stdout, '[SIGNALING]', '\x1b[35m');
prefixOutput(signaling.stderr, '[SIGNALING-ERR]', '\x1b[31m');

prefixOutput(frontend.stdout, '[FRONTEND]', '\x1b[36m');
prefixOutput(frontend.stderr, '[FRONTEND-ERR]', '\x1b[33m');

function cleanup() {
  console.log('\nShutting down SplitInfer servers...');
  signaling.kill('SIGINT');
  frontend.kill('SIGINT');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
