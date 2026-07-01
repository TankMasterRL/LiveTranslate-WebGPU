import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Fully client-side SPA: the ML runs in the browser on WebGPU, so there is
    // no server component. A 200.html fallback lets every route render client-side.
    adapter: adapter({ fallback: '200.html' })
  }
};

export default config;
