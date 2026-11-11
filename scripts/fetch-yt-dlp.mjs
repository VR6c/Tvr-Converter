// Downloads the standalone Linux yt-dlp into /bin so the key/BPM API route can
// run it on Vercel, where nothing is preinstalled. Local machines use their
// own yt-dlp (brew/pip), so this is a no-op off Linux.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, '..', 'bin', 'yt-dlp');
const assets = { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64' };
const asset = assets[process.arch];

if (process.platform !== 'linux' || !asset) {
  console.log('[fetch-yt-dlp] not a Linux build, skipping.');
  process.exit(0);
}

try {
  const res = await fetch(
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`,
  );
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  chmodSync(dest, 0o755);
  console.log(`[fetch-yt-dlp] downloaded ${asset} -> bin/yt-dlp`);
} catch (err) {
  // Don't fail the install: the rest of the app works without it.
  console.warn('[fetch-yt-dlp] download failed, YouTube audio analysis will be unavailable:', err);
}
