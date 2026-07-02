import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
  // NOTE: We deliberately do NOT enable Cross-Origin-Isolation (COOP/COEP:
  // require-corp). WebGPU inference does not need SharedArrayBuffer, and
  // enabling COEP would block the cross-origin YouTube <iframe> embed — the
  // core feature. The WASM fallback therefore runs single-threaded.
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['tests/e2e/**', 'node_modules/**']
  }
});
