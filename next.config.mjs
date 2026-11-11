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
        ],
      },
    ];
  },
};

export default nextConfig;
