import { expect, test } from '@playwright/test';

test('developer overlay is opt-in and edits the live fixture without game keyboard input', async ({ page }) => {
  await page.goto('/?packs=fixture&replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready);
  await expect(page.locator('#dev-debug')).toHaveCount(0);
  await page.goto('/?packs=fixture&replay&debug=1');
  await page.waitForFunction(() => window.openSinnohGame?.ready);
  await page.evaluate(() => {
    const game = window.openSinnohApp!.game;
    for (let i = 0; i < 600 && !(game.canSave() && game.state.vars['fixture:VAR_ROOM_INTRO'] === 1); i++) {
      if (game.scripts.view().message?.waitingForInput) { game.press('a'); game.tick(); game.release('a'); }
      game.tick();
    }
  });
  const panel = page.locator('#dev-debug');
  await panel.locator('summary').click();
  await panel.getByLabel('Flag', { exact: true }).fill('fixture:FLAG_TALKED_TO_HELPER');
  await panel.getByRole('button', { name: 'Set flag', exact: true }).click();
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.flags['fixture:FLAG_TALKED_TO_HELPER'])).toBe(true);
  await panel.getByRole('button', { name: 'Clear flag', exact: true }).click();
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.flags['fixture:FLAG_TALKED_TO_HELPER'] ?? false)).toBe(false);
  await panel.getByLabel('Var', { exact: true }).fill('fixture:VAR_SCENE');
  await panel.getByLabel('Value', { exact: true }).fill('42');
  await panel.getByRole('button', { name: 'Set var', exact: true }).click();
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.vars['fixture:VAR_SCENE'])).toBe(42);
  await panel.getByLabel('Species', { exact: true }).fill('fixture:SPECIES_MOSSLET');
  await panel.getByRole('button', { name: 'Give Pokémon' }).click();
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.party.length)).toBe(1);
  await panel.getByLabel('Item', { exact: true }).fill('fixture:ITEM_TONIC');
  await panel.getByRole('button', { name: 'Give item' }).click();
  await expect(panel.getByRole('status')).toHaveText('Done.');
  await panel.getByLabel('Date', { exact: true }).fill('2024-02-29');
  await panel.getByLabel('Time', { exact: true }).fill('21:30');
  await panel.getByRole('button', { name: 'Freeze clock' }).click();
  expect(await page.evaluate(() => window.openSinnohApp!.game.clock().hour)).toBe(21);
  await panel.getByLabel('Map', { exact: true }).fill('fixture:TOWN');
  await panel.getByLabel('Tile X').fill('10');
  await panel.getByLabel('Tile Z').fill('14');
  await panel.getByRole('button', { name: 'Warp', exact: true }).click();
  await page.evaluate(() => window.openSinnohGame!.advance(120));
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.player.zone)).toBe('fixture:TOWN');
  const before = await page.evaluate(() => window.openSinnohApp!.game.state.player);
  await panel.getByRole('button', { name: 'Read var' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => window.openSinnohGame!.advance(20));
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.player)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(panel).not.toHaveAttribute('open');
});

test('cached checkpoint load uses the normal session load boundary', async ({ page }) => {
  let save = '';
  await page.route('**/__opensinnoh/debug/checkpoints*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('id');
    if (id === 'cp4.replay:2') return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no cached anchor for cp4.replay seed 2' });
    return route.fulfill({ contentType: 'application/json', body: id ? save : JSON.stringify([{ id: 'cp4.replay:1', label: 'seed 1', cached: true }, { id: 'cp4.replay:2', label: 'seed 2 · not cached', cached: false }]) });
  });
  await page.goto('/?packs=fixture&replay&debug=1');
  await page.waitForFunction(() => window.openSinnohGame?.ready);
  save = await page.evaluate(() => {
    const game = window.openSinnohApp!.game;
    for (let i = 0; i < 600 && !(game.canSave() && game.state.vars['fixture:VAR_ROOM_INTRO'] === 1); i++) {
      if (game.scripts.view().message?.waitingForInput) { game.press('a'); game.tick(); game.release('a'); }
      game.tick();
    }
    game.state.vars['fixture:VAR_SCENE'] = 17;
    const save = JSON.stringify(game.save());
    game.state.vars['fixture:VAR_SCENE'] = 23;
    return save;
  });
  const panel = page.locator('#dev-debug');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Refresh cache' }).click();
  await expect(panel.getByRole('status')).toHaveText('Done.');
  await expect(panel.getByLabel('Story checkpoint')).toHaveValue('cp4.replay:1');
  // A missing anchor fails loudly and leaves the game alone.
  await panel.getByLabel('Story checkpoint').selectOption('cp4.replay:2');
  await panel.getByRole('button', { name: 'Load checkpoint' }).click();
  await expect(panel.getByRole('status')).toHaveText('no cached anchor for cp4.replay seed 2');
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.vars['fixture:VAR_SCENE'])).toBe(23);
  await panel.getByLabel('Story checkpoint').selectOption('cp4.replay:1');
  await panel.getByRole('button', { name: 'Load checkpoint' }).click();
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.game.state.vars['fixture:VAR_SCENE'])).toBe(17);
  await expect(panel.getByRole('status')).toHaveText('Done.');
});
