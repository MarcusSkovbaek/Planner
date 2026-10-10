export interface GestureHandlers {
  /** Called once the pointer moved beyond the threshold, then on every move/auto-scroll tick. */
  onMove?(x: number, y: number): void;
  /** `moved` is false for a plain click. */
  onEnd?(x: number, y: number, moved: boolean, event: PointerEvent): void;
  onCancel?(): void;
  /** Pixels the pointer must travel before it counts as a drag. */
  threshold?: number;
  /** Scroll container to auto-scroll when dragging near its top/bottom edge. */
  scroller?: HTMLElement | null;
  cursor?: string;
}

const EDGE = 48;
const MAX_SPEED = 18;

/**
 * Tracks a pointer gesture on the window (so it keeps working outside the element),
 * with click/drag discrimination, Escape to cancel and edge auto-scrolling. Losing the
 * window (Alt+Tab), a release that never reached the window and a right-click also cancel.
 */
export function startGesture(down: PointerEvent | React.PointerEvent, handlers: GestureHandlers): void {
  const startX = down.clientX;
  const startY = down.clientY;
  const threshold = handlers.threshold ?? 4;
  let x = startX;
  let y = startY;
  let moved = false;
  let frame = 0;
  const previousCursor = document.body.style.cursor;

  const autoScroll = () => {
    frame = 0;
    const el = handlers.scroller;
    if (!moved || !el) return;
    const rect = el.getBoundingClientRect();
    let delta = 0;
    if (y < rect.top + EDGE) delta = -Math.ceil(((rect.top + EDGE - y) / EDGE) * MAX_SPEED);
    else if (y > rect.bottom - EDGE) delta = Math.ceil(((y - (rect.bottom - EDGE)) / EDGE) * MAX_SPEED);
    if (!delta) return;
    const before = el.scrollTop;
    el.scrollTop += delta;
    if (el.scrollTop !== before) handlers.onMove?.(x, y);
    frame = requestAnimationFrame(autoScroll);
  };

  const onMove = (event: PointerEvent) => {
    // No button held: the release happened where the window could not see it.
    if (event.pointerType === 'mouse' && event.buttons === 0) return onCancel();
    x = event.clientX;
    y = event.clientY;
    if (!moved && Math.hypot(x - startX, y - startY) < threshold) return;
    if (!moved) {
      moved = true;
      document.body.classList.add('is-dragging');
      if (handlers.cursor) document.body.style.cursor = handlers.cursor;
    }
    handlers.onMove?.(x, y);
    if (!frame) frame = requestAnimationFrame(autoScroll);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('blur', onCancel);
    if (frame) cancelAnimationFrame(frame);
    document.body.classList.remove('is-dragging');
    document.body.style.cursor = previousCursor;
  };

  const onUp = (event: PointerEvent) => {
    cleanup();
    handlers.onEnd?.(event.clientX, event.clientY, moved, event);
  };

  const onCancel = () => {
    cleanup();
    handlers.onCancel?.();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  // A right-click mid-drag cancels the drag instead of opening a menu over it.
  const onContextMenu = (event: MouseEvent) => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('blur', onCancel);
}
