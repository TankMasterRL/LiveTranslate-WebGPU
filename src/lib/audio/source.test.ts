import { describe, expect, it, vi } from 'vitest';
import { requestAudioStream } from './source';

function mockMediaDevices() {
  const stream = {} as MediaStream;
  return {
    getDisplayMedia: vi.fn().mockResolvedValue(stream),
    getUserMedia: vi.fn().mockResolvedValue(stream)
  } as unknown as MediaDevices & {
    getDisplayMedia: ReturnType<typeof vi.fn>;
    getUserMedia: ReturnType<typeof vi.fn>;
  };
}

describe('requestAudioStream', () => {
  it('uses getDisplayMedia for tab/system audio (video required for the picker)', async () => {
    const md = mockMediaDevices();
    await requestAudioStream('tab', md);
    expect(md.getDisplayMedia).toHaveBeenCalledOnce();
    expect(md.getUserMedia).not.toHaveBeenCalled();
    const constraints = md.getDisplayMedia.mock.calls[0][0];
    expect(constraints.audio).toBeTruthy();
    expect(constraints.video).toBeTruthy();
    // The generic tab picker must not pre-select the app's own tab.
    expect(constraints.preferCurrentTab).toBeFalsy();
  });

  it("pre-selects this app's own tab for current-tab capture", async () => {
    const md = mockMediaDevices();
    await requestAudioStream('current-tab', md);
    expect(md.getDisplayMedia).toHaveBeenCalledOnce();
    expect(md.getUserMedia).not.toHaveBeenCalled();
    const constraints = md.getDisplayMedia.mock.calls[0][0];
    expect(constraints.audio).toBeTruthy();
    expect(constraints.video).toBeTruthy();
    expect(constraints.preferCurrentTab).toBe(true);
  });

  it('uses getUserMedia for the microphone with processing disabled', async () => {
    const md = mockMediaDevices();
    await requestAudioStream('microphone', md);
    expect(md.getUserMedia).toHaveBeenCalledOnce();
    const constraints = md.getUserMedia.mock.calls[0][0];
    expect(constraints.audio).toMatchObject({ echoCancellation: false, autoGainControl: false });
  });
});
