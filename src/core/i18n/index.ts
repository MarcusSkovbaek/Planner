import type { Language } from '../model';
import { da, type Dictionary } from './da';
import { en } from './en';

export type { Dictionary };

const DICTIONARIES: Record<Language, Dictionary> = { da, en };

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<Dictionary>;
export type TranslationParams = Record<string, string | number>;

export function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  const lookup = (dict: Dictionary): string | undefined => {
    let node: unknown = dict;
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === 'string' ? node : undefined;
  };
  const template = lookup(DICTIONARIES[language]) ?? lookup(da) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function localeOf(language: Language): string {
  return language === 'da' ? 'da-DK' : 'en-GB';
}

/** Hours with two decimals in the language's number format: `1,50` / `1.50`. */
export function formatHours(minutes: number, language: Language, fractionDigits = 2): string {
  return new Intl.NumberFormat(localeOf(language), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(minutes / 60);
}

/** Compact human duration: `45 min`, `1 t 20 min` / `1 h 20 min`. */
export function formatDuration(ms: number, language: Language): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hu = language === 'da' ? 't' : 'h';
  if (totalMin < 1) return language === 'da' ? '< 1 min' : '< 1 min';
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} ${hu}`;
  return `${h} ${hu} ${m} min`;
}
