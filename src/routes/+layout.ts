// Fully client-side SPA: WebGPU inference and media capture only exist in the
// browser, so we disable SSR and prerender the shell.
export const ssr = false;
export const prerender = true;
