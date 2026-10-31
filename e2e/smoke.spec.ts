import { expect, test } from '@playwright/test';

interface DebugHook {
  getState(): { seed: number; players: { x: number; y: number; dir: number }[]; room: { grid: { cells: string[] } } };
}

test('the game loads without console errors and responds to input', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/#seed-42');
  await expect(page.locator('canvas.game-canvas')).toBeVisible();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('click-to-play')).toBeVisible();

  // Debug overlay shows the seed from the URL.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-seed')).toHaveText('42');

  // A turn always succeeds, so it proves keyboard → command → state works.
  const dirBefore = await page.evaluate(
    () => (window as unknown as { __cop: DebugHook }).__cop.getState().players[0]!.dir,
  );
  await page.keyboard.press('KeyE');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __cop: DebugHook }).__cop.getState().players[0]!.dir))
    .toBe((dirBefore + 1) % 4);

  // Same seed on reload gives the same room.
  const roomA = await page.evaluate(() =>
    (window as unknown as { __cop: DebugHook }).__cop.getState().room.grid.cells.join(''),
  );
  await page.reload();
  const roomB = await page.evaluate(() =>
    (window as unknown as { __cop: DebugHook }).__cop.getState().room.grid.cells.join(''),
  );
  expect(roomB).toBe(roomA);

  // New seed changes the room and the URL.
  await page.keyboard.press('KeyR');
  await expect(page).not.toHaveURL(/#seed-42$/);

  expect(errors).toEqual([]);
});

test('a run starts from the class choice and can be continued after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await page.getByTestId('start-rogue').click();
  await expect(page.getByTestId('run-progress')).toBeVisible();
  // One step, so there is something to continue.
  await page.keyboard.press('KeyW');
  await page.goto('/');
  await expect(page.getByTestId('continue')).toBeVisible();
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('run-progress')).toBeVisible();
  expect(errors).toEqual([]);
});
