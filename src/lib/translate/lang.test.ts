import { describe, expect, it } from 'vitest';
import { AUTO, LANGUAGES, chooseLocalModel, floresCode } from './lang';

describe('LANGUAGES', () => {
  it('offers a curated set of at least 12 languages with unique codes', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(12);
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining(['en', 'ja', 'zh', 'es']));
  });

  it('maps every language to a FLORES code', () => {
    for (const lang of LANGUAGES) {
      expect(lang.flores).toMatch(/^[a-z]{3}_[A-Z][a-z]{3}$/);
    }
  });
});

describe('floresCode', () => {
  it('resolves known ISO codes to FLORES codes', () => {
    expect(floresCode('en')).toBe('eng_Latn');
    expect(floresCode('ja')).toBe('jpn_Jpan');
    expect(floresCode('zh')).toBe('zho_Hans');
  });

  it('returns null for unknown codes', () => {
    expect(floresCode('xx')).toBeNull();
    expect(floresCode(AUTO)).toBeNull();
  });
});

describe('chooseLocalModel', () => {
  it('picks the fast multilingual→English model for auto → en', () => {
    const choice = chooseLocalModel(AUTO, 'en');
    expect(choice).toEqual({ ok: true, model: 'Xenova/opus-mt-mul-en' });
  });

  it('picks NLLB with FLORES codes when the source is explicit', () => {
    const choice = chooseLocalModel('ja', 'en');
    expect(choice).toEqual({
      ok: true,
      model: 'Xenova/nllb-200-distilled-600M',
      srcCode: 'jpn_Jpan',
      tgtCode: 'eng_Latn'
    });
  });

  it('picks NLLB for non-English targets', () => {
    const choice = chooseLocalModel('en', 'ja');
    expect(choice).toMatchObject({ ok: true, model: 'Xenova/nllb-200-distilled-600M' });
  });

  it('rejects auto source for non-English targets (NLLB needs a source)', () => {
    const choice = chooseLocalModel(AUTO, 'ja');
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.reason).toMatch(/source/i);
  });

  it('rejects unknown languages', () => {
    expect(chooseLocalModel('xx', 'en').ok).toBe(false);
    expect(chooseLocalModel('en', 'xx').ok).toBe(false);
  });
});
