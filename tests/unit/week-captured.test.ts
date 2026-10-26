import { describe, expect, it } from 'vitest';
import { PlannerService } from '@core/backend/PlannerService';
import { MemoryStorage } from '@core/backend/storage';
import type { ActivitySegment } from '@core/model';

const platform = {
  info: { name: 'Planner', version: 'test', platform: 'web' as const, demo: true },
  async saveTextFile() {
    return true;
  },
  async openDataFolder() {},
};

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
const segment = (id: string, day: number, from: number, to: number, app = 'winword'): ActivitySegment => ({
  id,
  start: at(day, from),
  end: at(day, to),
  app,
  appName: app,
  title: `${id}.docx - Word`,
});

describe('PlannerService.getUnlinkedCaptured (week bars)', () => {
  it('counts captured time per day that no entry is linked to, leaving out excluded apps', async () => {
    const storage = new MemoryStorage();
    await storage.write('activity/2026-10-12', [segment('a', 12, 9, 11), segment('b', 12, 11, 12)]);
    await storage.write('activity/2026-10-13', [segment('c', 13, 9, 10), segment('d', 13, 10, 11, 'spotify')]);
    const service = new PlannerService({ storage, platform, clock: () => at(14, 12) });
    await service.init();
    await service.updateSettings({ tracking: { excludedApps: ['spotify'] } });
    await service.saveEntries([{ date: '2026-10-12', startMin: 540, endMin: 660, narrative: 'Kontrakt', matterId: null, activityIds: ['a'] }]);

    const hour = 3_600_000;
    expect(await service.getUnlinkedCaptured('2026-10-12', '2026-10-14')).toEqual({
      '2026-10-12': hour,
      '2026-10-13': hour,
      '2026-10-14': 0,
    });
    await expect(service.getUnlinkedCaptured('2026-10-14', '2026-10-12')).rejects.toThrow();
  });
});
