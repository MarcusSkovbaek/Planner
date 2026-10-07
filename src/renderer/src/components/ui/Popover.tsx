import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { computePosition, type Placement } from '@/lib/position';
import { cx } from '@/lib/cx';

interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** Element to position against, or a fixed point (context menus). */
  anchor: RefObject<HTMLElement | null> | { x: number; y: number };
  placement?: Placement;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** Match the anchor's width (comboboxes). */
  matchWidth?: boolean;
}

/** Floating layer rendered in a portal. Closes on outside click, Escape, scroll of the page and blur. */
export function Popover({ open, onClose, anchor, placement = 'bottom-start', className, style, children, matchWidth }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width?: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const anchorRect = () => {
    if ('current' in anchor) return anchor.current?.getBoundingClientRect() ?? null;
    return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y, width: 0, height: 0 };
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = anchorRect();
      const el = ref.current;
      if (!rect || !el) return;
      const size = el.getBoundingClientRect();
      const width = matchWidth ? Math.max(rect.width, size.width) : undefined;
      setPos({ ...computePosition(rect, { width: width ?? size.width, height: size.height }, placement), width });
    };
    update();
    const observer = new ResizeObserver(update);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if ('current' in anchor && anchor.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
      }
    };
    const onBlur = () => onCloseRef.current();
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={cx('popover', className)}
      style={{
        ...style,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        ...(pos?.width ? { width: pos.width } : {}),
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}
