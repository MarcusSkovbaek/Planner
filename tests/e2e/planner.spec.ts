import { expect, test, type Page } from '@playwright/test';

const HOUR = 96; // default hour height in px

async function openApp(page: Page, query = '?reset') {
  await page.goto('/' + query);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
}

/** Goes back day by day until a day with captured activity is shown. */
async function gotoDayWithData(page: Page) {
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('prev-day').click();
    await page.waitForTimeout(250);
    if ((await page.getByTestId('captured-card').count()) > 0 && (await page.getByTestId('entry-card').count()) > 0) return;
  }
  throw new Error('No seeded day with data found');
}

async function scrollBoardTo(page: Page, hour: number) {
  await page.getByTestId('board-scroller').evaluate((el, top) => (el.scrollTop = top), hour * HOUR);
  await page.waitForTimeout(100);
}

/** Click-drags in the entries column to create an entry in the evening (always empty). */
async function createEveningEntry(page: Page) {
  await scrollBoardTo(page, 19);
  const scroller = (await page.getByTestId('board-scroller').boundingBox())!;
  const column = (await page.getByTestId('entries-column').boundingBox())!;
  const x = column.x + column.width / 2;
  await page.mouse.move(x, scroller.y + 100);
  await page.mouse.down();
  await page.mouse.move(x, scroller.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('entry-editor')).toHaveClass(/open/);
}

test.describe('planner', () => {
  test('boots with demo data and navigates days with the keyboard', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('planner')).toBeVisible();
    const before = await page.getByTestId('planner-date').textContent();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('planner-date')).not.toHaveText(before!);
    await page.keyboard.press('t');
    await expect(page.getByTestId('planner-date')).toHaveText(before!);
  });

  test('drags captured time onto the timeline to create an entry, then undoes it', async ({ page }) => {
    await openApp(page);
    await gotoDayWithData(page);
    const entries = page.getByTestId('entry-card');
    const countBefore = await entries.count();

    const card = page.getByTestId('captured-card').nth(2);
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    const column = (await page.getByTestId('entries-column').boundingBox())!;
    await page.mouse.move(box.x + 12, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x - 40, box.y + 12, { steps: 4 });
    await page.mouse.move(column.x + column.width / 2, box.y + 12, { steps: 8 });
    await expect(page.locator('.ghost-range.drop')).toBeVisible();
    await page.mouse.up();

    await expect(entries).toHaveCount(countBefore + 1);
    await expect(page.getByTestId('entry-editor')).toHaveClass(/open/);
    await expect(page.getByTestId('narrative')).not.toHaveValue('');

    await page.getByTestId('toast').getByRole('button', { name: 'Fortryd' }).click();
    await expect(entries).toHaveCount(countBefore);
  });

  test('creates an entry by click-dragging, assigns a matter and releases it', async ({ page }) => {
    await openApp(page);
    await gotoDayWithData(page);
    await createEveningEntry(page);

    await page.getByTestId('narrative').fill('Telefonmøde med klient om forlig');
    await page.getByTestId('matter-picker').click();
    await page.getByTestId('matter-search').fill('havnegade');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('matter-picker')).toContainText('Havnegade Ejendomme');

    await page.getByTestId('editor-release').click();
    await expect(page.getByTestId('editor-reopen')).toBeVisible();
    const card = page.locator('[data-testid=entry-card].status-released', { hasText: 'Havnegade' }).last();
    await expect(card).toBeVisible();

    await page.getByTestId('editor-reopen').click();
    await expect(page.getByTestId('editor-release')).toBeVisible();
  });

  test('refuses to release an entry without a matter', async ({ page }) => {
    await openApp(page);
    await gotoDayWithData(page);
    await createEveningEntry(page);
    await page.getByTestId('editor-release').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Vælg en sag' })).toBeVisible();
    await expect(page.getByTestId('editor-release')).toBeVisible();
  });

  test('edits times from the editor and moves the entry with the mouse', async ({ page }) => {
    await openApp(page);
    await gotoDayWithData(page);
    await createEveningEntry(page);

    await page.getByTestId('start-input').fill('19:30');
    await page.getByTestId('start-input').press('Enter');
    await page.getByTestId('hours-input').fill('1,5');
    await page.getByTestId('hours-input').press('Enter');
    await expect(page.getByTestId('end-input')).toHaveValue('21:00');

    const card = page.locator('[data-testid=entry-card]', { hasText: '19:30' });
    await expect(card).toContainText('21:00');
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + HOUR, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('start-input')).toHaveValue('20:30');
    await expect(page.getByTestId('end-input')).toHaveValue('22:00');
  });

  test('deletes with the keyboard and restores with Ctrl+Z', async ({ page }) => {
    await openApp(page);
    await gotoDayWithData(page);
    await createEveningEntry(page);
    const entries = page.getByTestId('entry-card');
    const count = await entries.count();

    await page.getByTestId('narrative').blur();
    await page.keyboard.press('Delete');
    await expect(entries).toHaveCount(count - 1);
    await page.keyboard.press('Control+z');
    await expect(entries).toHaveCount(count);
  });

  test('filters captured activity by kind', async ({ page }) => {
    await openApp(page);
    await gotoDayWithData(page);
    const cards = page.getByTestId('captured-card');
    const all = await cards.count();
    await page.getByTestId('captured-filter').click();
    await page.locator('.fp-kind', { hasText: 'Dokument' }).locator('input').uncheck();
    await expect.poll(() => cards.count()).toBeLessThan(all);
    await page.getByRole('button', { name: 'Nulstil' }).click();
    await expect.poll(() => cards.count()).toBe(all);
  });

  test('persists entries across reloads', async ({ page }) => {
    await openApp(page);
    await gotoDayWithData(page);
    const date = await page.getByTestId('planner-date').textContent();
    await createEveningEntry(page);
    await page.getByTestId('narrative').fill('Persistens-test 4711');
    await page.getByTestId('narrative').blur();
    await page.waitForTimeout(300);

    await openApp(page, '');
    for (let i = 0; i < 6 && (await page.getByTestId('planner-date').textContent()) !== date; i++) {
      await page.getByTestId('prev-day').click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('[data-testid=entry-card]', { hasText: 'Persistens-test 4711' })).toHaveCount(1);
  });

  test('pauses and resumes automatic capture', async ({ page }) => {
    await openApp(page);
    const indicator = page.getByTestId('tracking-indicator');
    await expect(indicator).toContainText('Opfanger');
    await indicator.click();
    await page.getByTestId('pause-15').click();
    await expect(indicator).toContainText('Pauset');
    await indicator.click();
    await page.getByTestId('resume-tracking').click();
    await expect(indicator).toContainText('Opfanger');
  });
});

test.describe('other views', () => {
  test('switches language and theme', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('language-switch').getByRole('radio', { name: 'English' }).click();
    await expect(page.getByTestId('nav-matters')).toContainText('Matters');
    await page.getByTestId('theme-switch').getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('creates matters, rejects duplicates and imports pasted rows', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-matters').click();
    const rows = page.getByTestId('matter-row');
    const count = await rows.count();

    await page.getByTestId('new-matter').click();
    await page.getByTestId('mf-client-number').fill('300300');
    await page.getByTestId('mf-client-name').fill('Testklient ApS');
    await page.getByTestId('mf-matter-number').fill('000009');
    await page.getByTestId('mf-matter-name').fill('Generel rådgivning');
    await page.getByTestId('matter-save').click();
    await expect(rows).toHaveCount(count + 1);

    await page.getByTestId('new-matter').click();
    await page.getByTestId('mf-client-number').fill('300300');
    await page.getByTestId('mf-matter-number').fill('000009');
    await page.getByTestId('matter-save').click();
    await expect(page.getByTestId('matter-dialog')).toContainText('findes allerede');
    await page.keyboard.press('Escape');

    await page.getByTestId('import-matters').click();
    await page
      .getByTestId('import-text')
      .fill('Klientnr;Klient;Sagsnr;Sagsnavn\n400100;Vestkyst Shipping A/S;000001;Charterparti-tvist\n400200;Fjordbyen Kommune;000004;Udbud');
    await page.getByTestId('import-submit').click();
    await expect(rows).toHaveCount(count + 3);
  });

  test('lists the first matters and searches all of them in a long matter list', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-matters').click();
    await page.getByTestId('import-matters').click();
    const rows = Array.from({ length: 150 }, (_, i) => `${500001 + i};Testklient ${i + 1} ApS;000001;Rådgivning`);
    await page.getByTestId('import-text').fill(['Klientnr;Klient;Sagsnr;Sagsnavn', ...rows].join('\n'));
    await page.getByTestId('import-submit').click();
    await expect(page.getByTestId('import-text')).toBeHidden();

    await page.getByTestId('nav-planner').click();
    await gotoDayWithData(page);
    await createEveningEntry(page);
    await page.getByTestId('matter-picker').click();
    await expect(page.getByTestId('matter-search-hint')).toContainText(/Skriv for at søge i alle \d+ sager/);
    expect(await page.getByRole('option').count()).toBeLessThanOrEqual(110);

    await page.getByTestId('matter-search').fill('500150');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('matter-picker')).toContainText('Testklient 150 ApS');
  });

  test('lists entries and exports them as CSV', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-list').click();
    await page.getByRole('button', { name: 'Forrige periode' }).click();
    await expect(page.getByTestId('list-row').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-csv').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^tidsregistreringer_.*\.csv$/);
  });
});

test.describe('updates', () => {
  test('offers a verified update in the title bar and settings', async ({ page }) => {
    await openApp(page, '?reset&update=ready');
    await expect(page.getByTestId('update-pill')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('update-status')).toContainText('1.1.0');
    await page.getByTestId('update-pill').click();
    await expect(page.getByTestId('update-pill')).toHaveCount(0);
  });

  test('explains a rejected update', async ({ page }) => {
    await openApp(page, '?reset&update=error');
    await expect(page.getByTestId('update-pill')).toHaveCount(0);
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('update-status')).toContainText('signatur');
  });
});
