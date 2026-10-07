import { useCallback, useMemo } from 'react';
import { formatDuration, formatHours, localeOf, translate, type TranslationKey, type TranslationParams } from '@core/i18n';
import type { Language } from '@core/model';
import { useApp } from '@/state/app';

export type TFunction = (key: TranslationKey, params?: TranslationParams) => string;

export function tFor(language: Language): TFunction {
  return (key, params) => translate(language, key, params);
}

/** Translation + locale-aware formatting bound to the current language. */
export function useI18n() {
  const language = useApp((s) => s.settings.general.language);
  const t = useCallback<TFunction>((key, params) => translate(language, key, params), [language]);
  return useMemo(
    () => ({
      t,
      language,
      locale: localeOf(language),
      /** `1,50 t` / `1.50 h` */
      hours: (minutes: number, digits = 2) => `${formatHours(minutes, language, digits)} ${language === 'da' ? 't' : 'h'}`,
      hoursValue: (minutes: number, digits = 2) => formatHours(minutes, language, digits),
      duration: (ms: number) => formatDuration(ms, language),
    }),
    [t, language],
  );
}

/** Non-hook access for event handlers outside React render. */
export function currentT(): TFunction {
  return tFor(useApp.getState().settings.general.language);
}
