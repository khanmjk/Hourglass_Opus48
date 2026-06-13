import { defineConfig } from 'vite'

// rapier3d-compat ships its WASM inlined as base64, so no wasm plugin is needed.
// We exclude it from dep pre-bundling to avoid esbuild choking on the inlined binary.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat', '@dimforge/rapier3d-simd-compat'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
})
