import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { computePosition, type Placement } from '@/lib/position';

interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  placement?: Placement;
  delay?: number;
  disabled?: boolean;
  children: ReactNode;
}

export function Tooltip({ content, shortcut, placement = 'bottom', delay = 450, disabled, children }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    if (disabled) return;
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (disabled) hide();
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPos(computePosition(rect, tip.current.getBoundingClientRect(), placement, 8));
  }, [open, placement, content]);

  return (
    <span ref={anchor} className="tooltip-anchor" onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide}>
      {children}
      {open &&
        createPortal(
          <div ref={tip} className="tooltip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
            {content}
            {shortcut && <span className="kbd">{shortcut}</span>}
          </div>,
          document.body,
        )}
    </span>
  );
}
