import { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, Check, ChevronsUpDown, Plus, Search, Sparkles, X } from 'lucide-react';
import type { Matter } from '@core/model';
import { matterCode } from '@core/matters';
import { useI18n } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import { Popover } from '@/components/ui/Popover';

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'a');

export function matchesQuery(m: Matter, query: string): boolean {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = fold([matterCode(m), m.clientNumber, m.matterNumber, m.clientName, m.matterName, ...m.keywords].join(' '));
  return tokens.every((tok) => hay.includes(tok));
}

interface MatterPickerProps {
  value: string | null;
  matters: Matter[];
  onChange(id: string | null): void;
  suggestions?: Matter[];
  recent?: Matter[];
  disabled?: boolean;
  onCreateMatter?(): void;
}

type Row = { kind: 'header'; label: string; icon?: React.ReactNode } | { kind: 'matter'; matter: Matter };

export function MatterPicker({ value, matters, onChange, suggestions = [], recent = [], disabled, onCreateMatter }: MatterPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = value ? matters.find((m) => m.id === value) : undefined;

  const rows = useMemo<Row[]>(() => {
    const live = matters.filter((m) => !m.archived);
    if (query.trim()) {
      return live
        .filter((m) => matchesQuery(m, query))
        .slice(0, 60)
        .map((matter) => ({ kind: 'matter' as const, matter }));
    }
    const out: Row[] = [];
    const used = new Set<string>();
    const section = (label: string, list: Matter[], icon?: React.ReactNode) => {
      const items = list.filter((m) => !m.archived && !used.has(m.id));
      if (!items.length) return;
      out.push({ kind: 'header', label, icon });
      for (const matter of items) {
        used.add(matter.id);
        out.push({ kind: 'matter', matter });
      }
    };
    section(t('editor.suggestions'), suggestions, <Sparkles />);
    section(t('editor.recent'), recent);
    section(t('editor.allMatters'), [...live].sort((a, b) => matterCode(a).localeCompare(matterCode(b))));
    return out;
  }, [matters, query, suggestions, recent, t]);

  const selectable = rows.flatMap((r, i) => (r.kind === 'matter' ? [i] : []));

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectable[active]}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, selectable]);

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cx('matter-trigger', !selected && 'is-empty', selected && `matter-c${selected.color}`)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="matter-picker"
      >
        {selected ? (
          <>
            <span className="matter-dot" />
            <span className="mt-text">
              <span className="mt-code tabular">{matterCode(selected)}</span>
              <span className="mt-name truncate">
                {selected.clientName}
                {selected.matterName && <span className="muted"> – {selected.matterName}</span>}
              </span>
            </span>
          </>
        ) : (
          <>
            <Briefcase className="mt-placeholder-icon" />
            <span className="mt-placeholder">{t('editor.noMatter')}</span>
          </>
        )}
        <ChevronsUpDown className="mt-chevron" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={triggerRef} placement="bottom-start" matchWidth className="matter-popover">
        <div className="mp-search">
          <Search />
          <input
            autoFocus
            value={query}
            placeholder={t('editor.matterPlaceholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(selectable.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const row = rows[selectable[active] ?? -1];
                if (row?.kind === 'matter') choose(row.matter.id);
              }
            }}
            data-testid="matter-search"
          />
        </div>
        <div className="mp-list" ref={listRef} role="listbox">
          {rows.map((row, index) =>
            row.kind === 'header' ? (
              <div key={`h${index}`} className="mp-header">
                {row.icon}
                {row.label}
              </div>
            ) : (
              <button
                key={row.matter.id}
                type="button"
                role="option"
                aria-selected={row.matter.id === value}
                data-index={index}
                data-active={selectable[active] === index}
                className={cx('mp-option', `matter-c${row.matter.color}`)}
                onPointerEnter={() => setActive(selectable.indexOf(index))}
                onClick={() => choose(row.matter.id)}
              >
                <span className="matter-dot" />
                <span className="mp-option-text">
                  <span className="mp-option-name truncate">{row.matter.clientName || row.matter.matterName}</span>
                  <span className="mp-option-sub truncate">
                    <span className="tabular">{matterCode(row.matter)}</span>
                    {row.matter.matterName && row.matter.clientName && ` · ${row.matter.matterName}`}
                  </span>
                </span>
                {row.matter.id === value && <Check className="mp-check" />}
              </button>
            ),
          )}
          {!rows.length && <div className="mp-empty">{matters.length ? t('editor.noResults') : t('editor.noMatters')}</div>}
        </div>
        {(value || onCreateMatter) && (
          <div className="mp-footer">
            {value && (
              <button type="button" className="mp-footer-btn" onClick={() => choose(null)}>
                <X /> {t('editor.clearMatter')}
              </button>
            )}
            {onCreateMatter && (
              <button
                type="button"
                className="mp-footer-btn"
                onClick={() => {
                  setOpen(false);
                  onCreateMatter();
                }}
              >
                <Plus /> {t('editor.createMatter')}
              </button>
            )}
          </div>
        )}
      </Popover>
    </>
  );
}
