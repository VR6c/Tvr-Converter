// Copies ONNX Runtime Web runtime assets into /public/ort so the worker can
// load them same-origin (required under COEP: require-corp).
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(__dirname, '..', 'public', 'ort');

if (!existsSync(src)) {
  console.log('[copy-ort] onnxruntime-web not installed, skipping.');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });

const wanted = /\.(wasm|mjs|js)$/;
let n = 0;
for (const f of readdirSync(src)) {
  if (!wanted.test(f)) continue;
  copyFileSync(join(src, f), join(dest, f));
  n++;
}

console.log(`[copy-ort] copied ${n} runtime asset(s) -> public/ort`);
