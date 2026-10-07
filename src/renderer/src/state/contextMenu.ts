import type { ReactNode } from 'react';
import { create } from 'zustand';

export type MenuEntry =
  | {
      type?: 'item';
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string };

interface ContextMenuState {
  menu: { x: number; y: number; items: MenuEntry[] } | null;
  open(x: number, y: number, items: MenuEntry[]): void;
  close(): void;
}

export const useContextMenu = create<ContextMenuState>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null }),
}));

export function openContextMenu(event: { clientX: number; clientY: number; preventDefault(): void }, items: MenuEntry[]) {
  event.preventDefault();
  useContextMenu.getState().open(event.clientX, event.clientY, items);
}
