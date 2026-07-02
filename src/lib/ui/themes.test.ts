import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_ID,
  THEMES,
  getTheme,
  overlayStyle,
  type OverlaySettings
} from './themes';

describe('THEMES', () => {
  it('ports a palette of subtitle themes', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(14);
  });

  it('has unique ids and a valid default', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_THEME_ID);
  });
});

describe('getTheme', () => {
  it('returns the matching theme', () => {
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);
  });

  it('falls back to the default for an unknown id', () => {
    expect(getTheme('nope').id).toBe(DEFAULT_THEME_ID);
  });
});

describe('overlayStyle', () => {
  const settings: OverlaySettings = {
    themeId: DEFAULT_THEME_ID,
    fontScale: 1.5,
    position: 'bottom'
  };

  it('emits CSS custom properties for the theme colours', () => {
    const style = overlayStyle(settings);
    const theme = getTheme(DEFAULT_THEME_ID);
    expect(style).toContain(`--st-color: ${theme.textColor}`);
    expect(style).toContain(`--st-bg: ${theme.bgColor}`);
  });

  it('scales the font size by fontScale', () => {
    expect(overlayStyle({ ...settings, fontScale: 2 })).toContain('--st-font-scale: 2');
  });
});
