import { describe, expect, it } from 'vitest';
import { ActivityTracker } from '@core/tracking/ActivityTracker';
import type { WindowSample } from '@core/tracking/types';
import { PlannerService } from '@core/backend/PlannerService';
import { MemoryStorage } from '@core/backend/storage';
import type { ActivitySegment, Matter, TimeEntry } from '@core/model';

const platform = {
  info: { name: 'Planner', version: 'test', platform: 'web' as const, demo: true },
  saved: [] as string[],
  async saveTextFile(_name: string, content: string) {
    this.saved.push(content);
    return true;
  },
  async openDataFolder() {},
};

/** Memory storage whose next write to `failKey` throws, like a full disk or a locked file. */
class FlakyStorage extends MemoryStorage {
  failKey: string | null = null;

  override async write<T>(key: string, value: T): Promise<void> {
    if (key === this.failKey) {
      this.failKey = null;
      throw new Error('ENOSPC: no space left on device');
    }
    return super.write(key, value);
  }
}

/** Memory storage whose writes wait while `gate` is set, like a slow disk. */
class GatedStorage extends MemoryStorage {
  gate: Promise<void> | null = null;

  override async write<T>(key: string, value: T): Promise<void> {
    if (this.gate) await this.gate;
    return super.write(key, value);
  }
}

const ENTRY = { date: '2026-10-07', startMin: 540, endMin: 600, narrative: 'Møde med klient', matterId: null };

describe('PlannerService failed writes (data-4)', () => {
  it('does not keep an entry whose save failed', async () => {
    const storage = new FlakyStorage();
    const service = new PlannerService({ storage, platform });
    await service.init();
    storage.failKey = 'entries';
    await expect(service.saveEntries([ENTRY])).rejects.toThrow('ENOSPC');
    expect((await service.getDay('2026-10-07')).entries).toHaveLength(0);
    await service.saveEntries([ENTRY]);

    const reloaded = new PlannerService({ storage, platform });
    await reloaded.init();
    expect((await reloaded.getDay('2026-10-07')).entries).toHaveLength(1);
  });

  it('keeps an entry whose delete failed', async () => {
    const storage = new FlakyStorage();
    const service = new PlannerService({ storage, platform });
    await service.init();
    const [entry] = await service.saveEntries([ENTRY]);
    storage.failKey = 'entries';
    await expect(service.deleteEntries([entry!.id])).rejects.toThrow('ENOSPC');
    await service.saveEntries([{ ...ENTRY, startMin: 600, endMin: 660 }]);

    const reloaded = new PlannerService({ storage, platform });
    await reloaded.init();
    expect((await reloaded.getDay('2026-10-07')).entries.map((e) => e.id)).toContain(entry!.id);
  });

  it('keeps an entry a draft when its release failed', async () => {
    const storage = new FlakyStorage();
    const service = new PlannerService({ storage, platform });
    await service.init();
    const [entry] = await service.saveEntries([ENTRY]);
    storage.failKey = 'entries';
    await expect(service.setEntryStatus([entry!.id], 'released')).rejects.toThrow('ENOSPC');
    const [saved] = await service.saveEntries([{ ...entry!, narrative: 'Rettet' }]);
    expect(saved).toMatchObject({ status: 'draft', narrative: 'Rettet' });
    expect((await storage.read<TimeEntry[]>('entries'))![0]).toMatchObject({ status: 'draft' });
  });

  it('does not keep matter changes whose save failed', async () => {
    const storage = new FlakyStorage();
    const service = new PlannerService({ storage, platform });
    await service.init();
    storage.failKey = 'matters';
    await expect(service.saveMatter({ clientNumber: '1', matterNumber: '2' })).rejects.toThrow('ENOSPC');
    expect(await service.listMatters()).toHaveLength(0);

    const m = await service.saveMatter({ clientNumber: '1', matterNumber: '2' });
    storage.failKey = 'matters';
    await expect(service.deleteMatter(m.id)).rejects.toThrow('ENOSPC');
    expect((await service.listMatters()).map((x) => x.id)).toEqual([m.id]);

    storage.failKey = 'matters';
    await expect(service.importMatters([{ clientNumber: '3', matterNumber: '4' }])).rejects.toThrow('ENOSPC');
    await service.saveMatter({ ...m, matterName: 'Rådgivning' });
    expect((await storage.read<Matter[]>('matters'))!.map((x) => x.matterNumber)).toEqual(['2']);
  });
});

describe('PlannerService deleting the open segment (data-6)', () => {
  it('does not bring back a deleted segment that is still being recorded', async () => {
    const storage = new MemoryStorage();
    let now = new Date(2026, 9, 7, 9, 0).getTime();
    let tracker: ActivityTracker | null = null;
    let window: WindowSample = { app: 'winword', appName: 'Word', title: 'Privat - lægeerklæring.docx - Word' };
    let id = 0;
    const service = new PlannerService({
      storage,
      platform,
      clock: () => now,
      createTracker: (options, emit) => {
        tracker = new ActivityTracker(
          { id: 'fake', sample: () => window },
          { getIdleSeconds: () => 0 },
          options,
          emit,
          () => now,
          () => `seg${id++}`,
        );
        return tracker;
      },
    });
    const advance = async (seconds: number) => {
      for (let i = 0; i < seconds; i++) {
        now += 1000;
        await tracker!.tick();
      }
    };
    await service.init();
    await advance(20);
    await service.flush();
    const [segment] = (await service.getDay('2026-10-07')).activities;
    expect(segment).toBeDefined();

    await service.deleteActivities('2026-10-07', [segment!.id]);
    await advance(10);
    await service.flush();
    expect((await service.getDay('2026-10-07')).activities).toHaveLength(0);
    expect(await storage.read<ActivitySegment[]>('activity/2026-10-07')).toHaveLength(0);

    // The next window is recorded as usual.
    window = { app: 'outlook', appName: 'Outlook', title: 'Indbakke - Outlook' };
    await advance(20);
    await service.dispose();
    const saved = await storage.read<ActivitySegment[]>('activity/2026-10-07');
    expect(saved!.map((s) => s.app)).toEqual(['outlook']);
  });
});

describe('PlannerService deleting a segment that just closed (data-6)', () => {
  it('does not bring it back when its close event was queued behind the delete', async () => {
    const storage = new GatedStorage();
    let now = new Date(2026, 9, 7, 9, 0).getTime();
    let tracker: ActivityTracker | null = null;
    let window: WindowSample = { app: 'winword', appName: 'Word', title: 'Privat - lægeerklæring.docx - Word' };
    let id = 0;
    const service = new PlannerService({
      storage,
      platform,
      clock: () => now,
      createTracker: (options, emit) => {
        tracker = new ActivityTracker({ id: 'fake', sample: () => window }, { getIdleSeconds: () => 0 }, options, emit, () => now, () => `seg${id++}`);
        return tracker;
      },
    });
    const advance = async (seconds: number) => {
      for (let i = 0; i < seconds; i++) {
        now += 1000;
        await tracker!.tick();
      }
    };
    await service.init();
    await advance(20);
    await service.flush();
    const [segment] = (await service.getDay('2026-10-07')).activities;

    // A slow write holds the queue; the user deletes the block, then Planner takes focus, so the
    // tracker closes the segment and its close event lands in the queue after the delete.
    let release!: () => void;
    storage.gate = new Promise((resolve) => (release = resolve));
    const saving = service.saveEntries([ENTRY]);
    const deleting = service.deleteActivities('2026-10-07', [segment!.id]);
    window = { app: 'outlook', appName: 'Outlook', title: 'Indbakke - Outlook' };
    await advance(1);
    storage.gate = null;
    release();
    await Promise.all([saving, deleting]);
    await service.flush();
    expect((await service.getDay('2026-10-07')).activities.map((a) => a.id)).not.toContain(segment!.id);
    await service.dispose();
    expect((await storage.read<ActivitySegment[]>('activity/2026-10-07'))!.map((a) => a.id)).not.toContain(segment!.id);
  });
});

describe('PlannerService unknown matters (data-8)', () => {
  it('drops a matter id that no longer exists, so the entry cannot be released with it', async () => {
    const service = new PlannerService({ storage: new MemoryStorage(), platform });
    await service.init();
    const m = await service.saveMatter({ clientNumber: '1', matterNumber: '2', clientName: 'A', matterName: 'B' });
    const [entry] = await service.saveEntries([{ ...ENTRY, matterId: m.id }]);
    expect(entry!.matterId).toBe(m.id);
    await service.deleteEntries([entry!.id]);
    await service.deleteMatter(m.id);

    // Undo restores the deleted entry from its snapshot.
    const [restored] = await service.saveEntries([entry!]);
    expect(restored!.matterId).toBeNull();
  });
});
