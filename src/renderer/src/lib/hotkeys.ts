import { useEffect, useRef } from 'react';

/** Return `false` from a handler to let the key through (it was not handled). */
export type HotkeyMap = Record<string, (event: KeyboardEvent) => boolean | void>;

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Normalises an event to e.g. `mod+z`, `shift+arrowleft`, `delete`, `?`. */
export function comboOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  if (event.shiftKey && key.length > 1) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * Global keyboard shortcuts. Ignored while typing in inputs (except Escape) and while a
 * modal dialog is open, so shortcuts never fight with text entry.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const combo = comboOf(event);
      if (combo !== 'escape' && isEditable(event.target)) return;
      if (document.querySelector('.dialog-overlay') && combo !== 'escape') return;
      const handler = ref.current[combo];
      if (handler && handler(event) !== false) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
