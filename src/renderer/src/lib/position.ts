export type Placement = 'bottom-start' | 'bottom' | 'bottom-end' | 'top-start' | 'top' | 'top-end' | 'right-start' | 'left-start';

const MARGIN = 8;

/** Positions a floating element next to an anchor, flipping and clamping to the viewport. */
export function computePosition(
  anchor: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  size: { width: number; height: number },
  placement: Placement,
  offset = 6,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const [side, align = 'center'] = placement.split('-') as [string, string?];
  let left: number;
  let top: number;

  if (side === 'right' || side === 'left') {
    left = side === 'right' ? anchor.right + offset : anchor.left - size.width - offset;
    if (left + size.width > vw - MARGIN) left = anchor.left - size.width - offset;
    if (left < MARGIN) left = anchor.right + offset;
    top = anchor.top;
  } else {
    top = side === 'bottom' ? anchor.bottom + offset : anchor.top - size.height - offset;
    if (side === 'bottom' && top + size.height > vh - MARGIN && anchor.top - size.height - offset > MARGIN) {
      top = anchor.top - size.height - offset;
    } else if (side === 'top' && top < MARGIN) {
      top = anchor.bottom + offset;
    }
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - size.width : anchor.left + anchor.width / 2 - size.width / 2;
  }

  left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - size.width - MARGIN));
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - size.height - MARGIN));
  return { left: Math.round(left), top: Math.round(top) };
}
