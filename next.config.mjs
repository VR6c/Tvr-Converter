const isProd = process.env.NODE_ENV === 'production';

/**
 * Report-Only for now: logs violations in the console without blocking
 * anything. Promote to `Content-Security-Policy` once a production build has
 * been exercised (load, play, record, export) with no reports.
 * 'unsafe-inline' is needed by Next's inline bootstrap and the theme script;
 * 'wasm-unsafe-eval' by ONNX Runtime.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, layers: true };

    // Required for Web Workers bundled by Next.js on Vercel
    if (!isServer) {
      config.output = {
        ...config.output,
        // Ensure WASM assets resolve correctly from /ort/ at runtime
        webassemblyModuleFilename: 'static/wasm/[modulehash].wasm',
      };
    }

    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Microphone is used for in-app recording; nothing else is needed.
          {
            key: 'Permissions-Policy',
            value: 'microphone=(self), camera=(), geolocation=(), payment=()',
          },
          ...(isProd
            ? [{ key: 'Content-Security-Policy-Report-Only', value: csp }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
