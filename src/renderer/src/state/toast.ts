import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  show(toast: Omit<Toast, 'id' | 'duration' | 'tone'> & { tone?: ToastTone; duration?: number }): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show(input) {
    const id = nextId++;
    const toast: Toast = { tone: 'success', duration: input.action ? 6000 : 3500, ...input, id };
    // Keep the stack short and never show the same message twice; the newest one matters most.
    set({ toasts: [...get().toasts.filter((t) => t.message !== toast.message).slice(-2), toast] });
    setTimeout(() => get().dismiss(id), toast.duration);
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = (input: Parameters<ToastState['show']>[0]) => useToasts.getState().show(input);
