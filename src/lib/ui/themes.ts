/**
 * Subtitle colour themes, ported in spirit from LiveTranslate's overlay themes.
 * A theme is just the colours; layout (position, size) lives in OverlaySettings.
 */
export interface SubtitleTheme {
  id: string;
  name: string;
  /** Foreground text colour. */
  textColor: string;
  /** Background pill colour behind the text (usually translucent). */
  bgColor: string;
  /** Outline / shadow colour for legibility over video. */
  outlineColor: string;
}

export type OverlayPosition = 'top' | 'middle' | 'bottom';

export interface OverlaySettings {
  themeId: string;
  /** Multiplier applied to the base font size (1 = default). */
  fontScale: number;
  position: OverlayPosition;
}

const t = (
  id: string,
  name: string,
  textColor: string,
  bgColor: string,
  outlineColor = 'rgba(0,0,0,0.85)'
): SubtitleTheme => ({ id, name, textColor, bgColor, outlineColor });

export const THEMES: SubtitleTheme[] = [
  t('classic', 'Classic White', '#ffffff', 'rgba(0,0,0,0.55)'),
  t('netflix', 'Soft White', '#f5f5f5', 'rgba(0,0,0,0.0)'),
  t('sunflower', 'Sunflower', '#ffd400', 'rgba(0,0,0,0.55)'),
  t('mint', 'Mint', '#7fffd4', 'rgba(0,0,0,0.55)'),
  t('sky', 'Sky', '#8ecbff', 'rgba(0,0,0,0.55)'),
  t('rose', 'Rose', '#ff8fb1', 'rgba(0,0,0,0.55)'),
  t('lime', 'Lime', '#b6ff3d', 'rgba(0,0,0,0.55)'),
  t('amber', 'Amber', '#ffb300', 'rgba(0,0,0,0.55)'),
  t('lavender', 'Lavender', '#c9b6ff', 'rgba(0,0,0,0.55)'),
  t('cyan', 'Cyan', '#38e0e0', 'rgba(0,0,0,0.55)'),
  t('coral', 'Coral', '#ff6f61', 'rgba(0,0,0,0.55)'),
  t('ink', 'Ink on Cream', '#141414', 'rgba(255,246,214,0.9)', 'rgba(255,255,255,0.6)'),
  t('terminal', 'Terminal', '#33ff66', 'rgba(0,0,0,0.8)', 'rgba(0,60,0,0.9)'),
  t('highvis', 'High Visibility', '#000000', 'rgba(255,235,59,0.95)', 'rgba(255,255,255,0.7)'),
  t('paper', 'Paper', '#1a1a1a', 'rgba(255,255,255,0.92)', 'rgba(0,0,0,0.25)')
];

export const DEFAULT_THEME_ID = 'classic';

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

/** Look up a theme by id, falling back to the default for unknown ids. */
export function getTheme(id: string): SubtitleTheme {
  return THEME_BY_ID.get(id) ?? THEME_BY_ID.get(DEFAULT_THEME_ID)!;
}

/** Build the inline `style` string of CSS custom properties for the overlay. */
export function overlayStyle(settings: OverlaySettings): string {
  const theme = getTheme(settings.themeId);
  return [
    `--st-color: ${theme.textColor}`,
    `--st-bg: ${theme.bgColor}`,
    `--st-outline: ${theme.outlineColor}`,
    `--st-font-scale: ${settings.fontScale}`
  ].join('; ');
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  themeId: DEFAULT_THEME_ID,
  fontScale: 1,
  position: 'bottom'
};
