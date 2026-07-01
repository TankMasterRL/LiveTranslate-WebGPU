import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRANSLATION_SETTINGS, type TranslationSettings } from '../translate/factory';
import TranslatePanel from './TranslatePanel.svelte';

const make = (overrides: Partial<TranslationSettings> = {}): TranslationSettings => ({
  ...DEFAULT_TRANSLATION_SETTINGS,
  api: { ...DEFAULT_TRANSLATION_SETTINGS.api },
  ...overrides
});

const baseProps = { progress: 0, error: null, active: false, onApply: () => {} };

describe('TranslatePanel', () => {
  it('shows only the mode select when translation is off', () => {
    render(TranslatePanel, { props: { ...baseProps, settings: make() } });
    expect(screen.getByLabelText(/mode/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/target language/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/endpoint/i)).not.toBeInTheDocument();
  });

  it('shows source and target selects in local mode', () => {
    render(TranslatePanel, { props: { ...baseProps, settings: make({ mode: 'local' }) } });
    expect(screen.getByLabelText(/source language/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target language/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/endpoint/i)).not.toBeInTheDocument();
  });

  it('shows endpoint, key and model fields in api mode', () => {
    render(TranslatePanel, { props: { ...baseProps, settings: make({ mode: 'api' }) } });
    expect(screen.getByLabelText(/endpoint/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target language/i)).toBeInTheDocument();
  });

  it('calls onApply when the apply button is clicked', async () => {
    const onApply = vi.fn();
    render(TranslatePanel, {
      props: { ...baseProps, settings: make({ mode: 'local' }), onApply }
    });
    await fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('surfaces errors', () => {
    render(TranslatePanel, {
      props: { ...baseProps, settings: make({ mode: 'local' }), error: 'pick a source' }
    });
    expect(screen.getByRole('alert')).toHaveTextContent('pick a source');
  });
});
