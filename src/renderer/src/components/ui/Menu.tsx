import { useEffect, useRef, useState } from 'react';
import type { MenuEntry } from '@/state/contextMenu';
import { cx } from '@/lib/cx';

interface MenuProps {
  items: MenuEntry[];
  onClose(): void;
  autoFocus?: boolean;
}

/** Keyboard navigable menu list used by dropdowns and context menus. */
export function Menu({ items, onClose, autoFocus = true }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const actionable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.type === undefined || item.type === 'item') && !('disabled' in item && item.disabled));
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const run = (index: number) => {
    const entry = items[index];
    if (!entry || (entry.type !== undefined && entry.type !== 'item') || entry.disabled) return;
    onClose();
    entry.onSelect();
  };

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      onKeyDown={(event) => {
        const pos = actionable.findIndex((a) => a.index === active);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActive(actionable[(pos + 1) % actionable.length]?.index ?? -1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActive(actionable[(pos - 1 + actionable.length) % actionable.length]?.index ?? -1);
        } else if (event.key === 'Enter' && active >= 0) {
          event.preventDefault();
          run(active);
        }
      }}
    >
      {items.map((entry, index) => {
        if (entry.type === 'separator') return <div key={index} className="menu-separator" role="separator" />;
        if (entry.type === 'label') return <div key={index} className="menu-label">{entry.label}</div>;
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={cx('menu-item', entry.danger && 'danger')}
            disabled={entry.disabled}
            data-active={active === index}
            onPointerEnter={() => setActive(index)}
            onClick={() => run(index)}
          >
            {entry.icon}
            <span className="truncate">{entry.label}</span>
            {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
