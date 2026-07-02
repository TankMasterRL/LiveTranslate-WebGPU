export interface WebGPUSupport {
  supported: boolean;
  reason?: string;
}

/**
 * Detect whether WebGPU is usable by actually requesting an adapter. Mirrors
 * the capability check Simon Willison's Moebius port relies on before choosing
 * the WebGPU execution provider.
 */
export async function detectWebGPU(nav: Navigator = navigator): Promise<WebGPUSupport> {
  const gpu = (nav as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) {
    return { supported: false, reason: 'WebGPU is not available in this browser.' };
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'No suitable GPU adapter was found.' };
    }
    return { supported: true };
  } catch {
    return { supported: false, reason: 'Requesting a GPU adapter failed.' };
  }
}
