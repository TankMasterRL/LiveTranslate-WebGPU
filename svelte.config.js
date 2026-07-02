import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Serve from a subpath (e.g. GitHub Pages) with BASE_PATH=/repo-name at build
// time. Normalized to SvelteKit's rules: leading slash, no trailing slash.
const rawBase = process.env.BASE_PATH ?? '';
const base = rawBase ? `/${rawBase.replace(/^\/+|\/+$/g, '')}` : '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Fully client-side SPA: the ML runs in the browser on WebGPU, so there is
    // no server component. A 200.html fallback lets every route render client-side.
    adapter: adapter({ fallback: '200.html' }),
    paths: { base }
  }
};

export default config;
