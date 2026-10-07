import { create } from 'zustand';
import type { PlannerEvent } from '@core/api';
import { apiErrorCode, ApiErrorCode } from '@core/api';
import type { ActivitySegment, DateKey, EntryStatus, TimeEntry, TimeEntryInput } from '@core/model';
import { addDays, dateKeyOf, startOfWeek } from '@core/time';
import { sortEntries } from '@core/entries';
import { api } from '@/api/client';
import { currentT } from '@/lib/i18n';
import { toast } from './toast';

type UndoAction =
  | { kind: 'delete'; ids: string[] }
  | { kind: 'restore'; entries: TimeEntry[] }
  | { kind: 'status'; ids: string[]; status: EntryStatus };

interface UndoItem {
  label: string;
  actions: UndoAction[];
}

const MAX_UNDO = 30;

interface PlannerState {
  date: DateKey;
  weekStart: DateKey;
  /** Entries of the week containing `date`. */
  entries: TimeEntry[];
  /** Captured activity of `date`. */
  activities: ActivitySegment[];
  activitiesDate: DateKey | null;
  loading: boolean;
  selectedEntryIds: string[];
  selectedBlockIds: string[];
  editingId: string | null;
  undoStack: UndoItem[];

  load(date?: DateKey): Promise<void>;
  setDate(date: DateKey): Promise<void>;
  /** Navigates to `date` and opens the entry in the editor. */
  focusEntry(date: DateKey, id: string): Promise<void>;
  shiftDay(delta: number): void;
  selectEntry(id: string, mode?: 'replace' | 'toggle'): void;
  selectBlocks(ids: string[], mode?: 'replace' | 'toggle' | 'add'): void;
  clearSelection(): void;
  openEditor(id: string | null): void;
  createEntries(inputs: TimeEntryInput[], options?: { edit?: boolean }): Promise<TimeEntry[]>;
  updateEntry(id: string, patch: Partial<TimeEntry>, options?: { undoable?: boolean }): Promise<void>;
  deleteEntries(ids: string[]): Promise<void>;
  setStatus(ids: string[], status: EntryStatus): Promise<number>;
  duplicateEntry(id: string): Promise<void>;
  deleteActivities(ids: string[]): Promise<void>;
  undo(): Promise<void>;
  handleEvent(event: PlannerEvent): void;
}

let loadSeq = 0;

function reportError(err: unknown) {
  const t = currentT();
  const code = apiErrorCode(err);
  toast({ tone: 'error', message: code === ApiErrorCode.EntryLocked ? t('toast.locked') : t('common.errorGeneric') });
  console.error(err);
}

export const usePlanner = create<PlannerState>((set, get) => {
  const pushUndo = (label: string, actions: UndoAction[]) => {
    set({ undoStack: [...get().undoStack.slice(-(MAX_UNDO - 1)), { label, actions }] });
  };

  const inWeek = (date: DateKey) => {
    const start = get().weekStart;
    return date >= start && date <= addDays(start, 6);
  };

  const upsertEntries = (changed: TimeEntry[], removed: string[] = []) => {
    const map = new Map(get().entries.map((e) => [e.id, e]));
    for (const id of removed) map.delete(id);
    for (const e of changed) {
      if (inWeek(e.date)) map.set(e.id, e);
      else map.delete(e.id);
    }
    const entries = sortEntries([...map.values()]);
    const ids = new Set(entries.map((e) => e.id));
    const { editingId, selectedEntryIds } = get();
    set({
      entries,
      selectedEntryIds: selectedEntryIds.filter((id) => ids.has(id)),
      editingId: editingId && ids.has(editingId) ? editingId : null,
    });
  };

  const undoToast = (message: string) =>
    toast({
      message,
      action: { label: currentT()('common.undo'), run: () => void get().undo() },
    });

  return {
    date: dateKeyOf(Date.now()),
    weekStart: startOfWeek(dateKeyOf(Date.now())),
    entries: [],
    activities: [],
    activitiesDate: null,
    loading: false,
    selectedEntryIds: [],
    selectedBlockIds: [],
    editingId: null,
    undoStack: [],

    async load(date = get().date) {
      const seq = ++loadSeq;
      const weekStart = startOfWeek(date);
      set({ loading: true });
      try {
        const [day, week] = await Promise.all([
          api().getDay(date),
          api().getEntries(weekStart, addDays(weekStart, 6)),
        ]);
        if (seq !== loadSeq) return;
        set({ activities: day.activities, activitiesDate: date, entries: week, weekStart, loading: false });
      } catch (err) {
        if (seq === loadSeq) set({ loading: false });
        reportError(err);
      }
    },

    setDate(date) {
      if (date === get().date && get().activitiesDate === date) return Promise.resolve();
      const weekStart = startOfWeek(date);
      set({
        date,
        selectedBlockIds: [],
        selectedEntryIds: [],
        editingId: null,
        // Keep the week's entries while switching day inside the same week (no flicker).
        ...(weekStart !== get().weekStart ? { entries: [], weekStart } : {}),
        activities: [],
        activitiesDate: null,
      });
      return get().load(date);
    },

    async focusEntry(date, id) {
      await get().setDate(date);
      if (get().entries.some((e) => e.id === id)) set({ editingId: id, selectedEntryIds: [id], selectedBlockIds: [] });
    },

    shiftDay(delta) {
      void get().setDate(addDays(get().date, delta));
    },

    selectEntry(id, mode = 'replace') {
      const current = get().selectedEntryIds;
      const selected =
        mode === 'toggle' ? (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]) : [id];
      set({
        selectedEntryIds: selected,
        selectedBlockIds: [],
        editingId: selected.length === 1 ? selected[0]! : null,
      });
    },

    selectBlocks(ids, mode = 'replace') {
      const current = get().selectedBlockIds;
      let selected: string[];
      if (mode === 'replace') selected = ids;
      else if (mode === 'add') selected = [...new Set([...current, ...ids])];
      else selected = ids.every((id) => current.includes(id)) ? current.filter((x) => !ids.includes(x)) : [...new Set([...current, ...ids])];
      set({ selectedBlockIds: selected, selectedEntryIds: [], editingId: null });
    },

    clearSelection() {
      set({ selectedBlockIds: [], selectedEntryIds: [], editingId: null });
    },

    openEditor(id) {
      set({ editingId: id, selectedEntryIds: id ? [id] : [], selectedBlockIds: [] });
    },

    async createEntries(inputs, options = {}) {
      if (!inputs.length) return [];
      try {
        const saved = await api().saveEntries(inputs);
        upsertEntries(saved);
        pushUndo('create', [{ kind: 'delete', ids: saved.map((e) => e.id) }]);
        const t = currentT();
        undoToast(saved.length === 1 ? t('toast.entryCreated') : t('toast.entriesCreated', { n: saved.length }));
        const edit = options.edit ?? saved.length === 1;
        set({
          selectedBlockIds: [],
          selectedEntryIds: saved.map((e) => e.id),
          editingId: edit && saved.length === 1 ? saved[0]!.id : null,
        });
        return saved;
      } catch (err) {
        reportError(err);
        return [];
      }
    },

    async updateEntry(id, patch, options = {}) {
      const previous = get().entries.find((e) => e.id === id);
      if (!previous) return;
      if (previous.status === 'released' && patch.status !== 'draft') {
        toast({ tone: 'error', message: currentT()('toast.locked') });
        return;
      }
      const next: TimeEntry = { ...previous, ...patch, id };
      upsertEntries([next]); // optimistic
      if (options.undoable) pushUndo('update', [{ kind: 'restore', entries: [previous] }]);
      try {
        const [saved] = await api().saveEntries([next]);
        if (saved) upsertEntries([saved]);
      } catch (err) {
        upsertEntries([previous]);
        reportError(err);
      }
    },

    async deleteEntries(ids) {
      const victims = get().entries.filter((e) => ids.includes(e.id));
      if (!victims.length) return;
      // Optimistic: the entries disappear at once, so the undo step must exist at once too.
      upsertEntries([], ids);
      const item: UndoItem = { label: 'delete', actions: [{ kind: 'restore', entries: victims }] };
      set({ undoStack: [...get().undoStack.slice(-(MAX_UNDO - 1)), item] });
      const t = currentT();
      undoToast(victims.length === 1 ? t('toast.entryDeleted') : t('toast.entriesDeleted', { n: victims.length }));
      try {
        await api().deleteEntries(ids);
      } catch (err) {
        set({ undoStack: get().undoStack.filter((u) => u !== item) });
        upsertEntries(victims);
        reportError(err);
      }
    },

    async setStatus(ids, status) {
      const t = currentT();
      const candidates = get().entries.filter((e) => ids.includes(e.id) && e.status !== status);
      if (!candidates.length) {
        if (status === 'released') toast({ tone: 'info', message: t('toast.nothingToRelease') });
        return 0;
      }
      let eligible = candidates;
      if (status === 'released') {
        eligible = candidates.filter((e) => e.matterId);
        const missing = candidates.length - eligible.length;
        if (missing) {
          toast({
            tone: 'error',
            message: candidates.length === 1 ? t('toast.missingMatter') : t('toast.missingMatterMany', { n: missing }),
          });
          if (!eligible.length) return 0;
        }
      }
      try {
        const changed = await api().setEntryStatus(
          eligible.map((e) => e.id),
          status,
        );
        upsertEntries(changed);
        pushUndo('status', [{ kind: 'status', ids: changed.map((e) => e.id), status: status === 'released' ? 'draft' : 'released' }]);
        if (status === 'released') {
          undoToast(changed.length === 1 ? t('toast.released') : t('toast.releasedMany', { n: changed.length }));
        } else {
          undoToast(t('toast.reopened'));
        }
        return changed.length;
      } catch (err) {
        reportError(err);
        return 0;
      }
    },

    async duplicateEntry(id) {
      const source = get().entries.find((e) => e.id === id);
      if (!source) return;
      const length = source.endMin - source.startMin;
      const startMin = Math.min(source.endMin, 24 * 60 - length);
      const [copy] = await get().createEntries(
        [
          {
            date: source.date,
            startMin,
            endMin: startMin + length,
            matterId: source.matterId,
            narrative: source.narrative,
            billingType: source.billingType,
            activityIds: [],
          },
        ],
        { edit: true },
      );
      if (copy) toast({ message: currentT()('toast.entryDuplicated') });
    },

    async deleteActivities(ids) {
      const date = get().activitiesDate;
      if (!date || !ids.length) return;
      const remove = new Set(ids);
      set({ activities: get().activities.filter((a) => !remove.has(a.id)), selectedBlockIds: [] });
      try {
        await api().deleteActivities(date, ids);
        toast({ message: currentT()('toast.activityDeleted') });
      } catch (err) {
        reportError(err);
        void get().load();
      }
    },

    async undo() {
      const stack = get().undoStack;
      const item = stack[stack.length - 1];
      if (!item) return;
      set({ undoStack: stack.slice(0, -1) });
      try {
        for (const action of [...item.actions].reverse()) {
          if (action.kind === 'delete') {
            await api().deleteEntries(action.ids);
            upsertEntries([], action.ids);
          } else if (action.kind === 'restore') {
            const current = new Map(get().entries.map((e) => [e.id, e]));
            // Released versions must be reopened before they can be overwritten.
            const locked = action.entries.filter((e) => current.get(e.id)?.status === 'released').map((e) => e.id);
            if (locked.length) await api().setEntryStatus(locked, 'draft');
            const saved = await api().saveEntries(action.entries);
            upsertEntries(saved);
          } else {
            const changed = await api().setEntryStatus(action.ids, action.status);
            upsertEntries(changed);
          }
        }
        toast({ tone: 'info', message: currentT()('toast.undone') });
      } catch (err) {
        reportError(err);
        void get().load();
      }
    },

    handleEvent(event) {
      const state = get();
      switch (event.type) {
        case 'activity': {
          if (event.date !== state.activitiesDate) return;
          const list = state.activities;
          const index = list.findIndex((a) => a.id === event.segment.id);
          const next = [...list];
          if (index >= 0) next[index] = event.segment;
          else next.push(event.segment);
          set({ activities: next });
          break;
        }
        case 'activity-removed': {
          if (event.date !== state.activitiesDate) return;
          const remove = new Set(event.ids);
          set({ activities: state.activities.filter((a) => !remove.has(a.id)) });
          break;
        }
        case 'entries':
          upsertEntries(event.changed, event.removed);
          break;
      }
    },
  };
});
