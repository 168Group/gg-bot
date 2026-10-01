import { test, expect } from '@playwright/test';
import { eventTypes, eventLabels } from '../../modules/logging/shared/settings.js';
test('staff can inspect fixtures, save routing, preview and run a delivery test', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/auth/demo');
  await expect(page.getByRole('heading', { name: 'Your community, at a glance.' })).toBeVisible();
  await expect(page.getByText('LOCAL DEMO', { exact: false })).toBeVisible();
  await expect(page.getByText('Simulated', { exact: true })).toBeVisible();
  await expect(page.getByText('PocketBase', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1)).toBe(true);
  await page.screenshot({ path: `test-results/overview-${test.info().project.name}.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Configure logging' }).click();
  await page.getByLabel('Log destination').selectOption('100000000000000010');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Preview log' }).click();
  await expect(page.getByText('PREVIEW · NOT SENT', { exact: true })).toBeVisible();
  const preview = page.locator('.embed-preview');
  await expect(preview.getByText('Text channel', { exact: true })).toBeVisible();
  await expect(preview.getByText('1 custom overwrite · 1 role', { exact: true })).toBeVisible();
  await expect(preview.getByText('Before', { exact: true })).toHaveCount(0);
  await expect(preview.getByText('After', { exact: true })).toHaveCount(0);
  await expect(preview.getByText('Reason', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1)).toBe(true);
  await preview.screenshot({ path: `test-results/log-preview-${test.info().project.name}.png`, animations: 'disabled' });
  await page.reload();
  await expect(page.getByLabel('Log destination')).toHaveValue('100000000000000010');
  await page.getByRole('link', { name: 'Diagnostics', exact: true }).click();
  await page.getByRole('button', { name: 'Send test log' }).click();
  await expect(page.getByText('Job completed:', { exact: false })).toBeVisible({ timeout: 15000 });
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByLabel('Event type').selectOption('logging.test');
  await expect(page.getByRole('link', { name: /Delivery test/ }).first()).toBeVisible();
  await page.getByRole('link', { name: /Delivery test/ }).first().click();
  await expect(page.getByText('Unknown. No confirmed audit evidence.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('anonymous users see sign-in and protected APIs reject access', async ({ page, request }) => {
  await page.goto('/modules/logging');
  await expect(page.getByRole('link', { name: 'Continue with Discord' })).toBeVisible();
  const response = await request.get('/api/modules/logging/events');
  expect(response.status()).toBe(401);
});
test('staff can configure, preview and inspect message, member and voice logging', async ({ page }) => {
  await page.goto('/auth/demo');
  await page.getByRole('link', { name: 'Configure logging' }).click();
  await expect(page.getByText(/Enable Server Members Intent and Message Content Intent/)).toBeVisible();
  const additions = eventTypes.filter(type => !type.startsWith('channel.'));
  for (const type of additions) {
    const toggle = page.getByRole('checkbox', { name: new RegExp(eventLabels[type]!) });
    await expect(toggle).toBeVisible(); await toggle.uncheck();
  }
  await page.getByRole('checkbox', { name: /Message edited/ }).check();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Message edited/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Message deleted/ })).not.toBeChecked();
  const expectedField: Record<string, string> = { 'message.edited': 'Before', 'message.deleted': 'Deleted content', 'member.nickname.updated': 'After', 'member.roles.updated': 'Roles added', 'voice.joined': 'Channel', 'voice.left': 'Channel' };
  for (const type of additions) {
    await page.getByLabel('Preview event', { exact: true }).selectOption(type);
    await page.getByRole('button', { name: 'Preview log', exact: true }).click();
    const preview = page.locator('.embed-preview');
    await expect(preview.getByRole('heading', { name: eventLabels[type], exact: true })).toBeVisible();
    await expect(preview.getByText(expectedField[type]!, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1)).toBe(true);
    await preview.screenshot({ path: `test-results/activity-${type}-${test.info().project.name}.png`, animations: 'disabled' });
  }
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  for (const type of additions) {
    await page.getByLabel('Event type', { exact: true }).selectOption(type);
    const row = page.getByRole('link', { name: new RegExp(eventLabels[type]!) }).first();
    await expect(row).toBeVisible();
  }
  await page.getByRole('link', { name: /Voice channel left/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Voice channel left', exact: true })).toBeVisible();
  await expect(page.getByText('Unknown. No confirmed audit evidence.', { exact: true })).toBeVisible();
});
test('a separate module saves settings, runs a job, and reads its own persisted data', async ({ page }) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/auth/demo');
  await page.getByRole('link',{name:/^Modules/}).click();
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Example module',exact:true})});
  await expect(card).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1)).toBe(true);
  if (await card.getByRole('button',{name:'Enable',exact:true}).count()) await card.getByRole('button',{name:'Enable',exact:true}).click();
  await expect(async () => { await page.getByRole('button', { name: 'Refresh workspace' }).click(); await expect(card.getByText('Active',{exact:true})).toBeVisible({timeout:1000}); }).toPass({timeout:15000});
  await card.getByRole('link',{name:'Open module'}).click();
  const greeting=`Hello ${test.info().project.name} ${Date.now()}`;
  await page.getByLabel('Greeting',{exact:true}).fill(greeting);
  await expect(page.getByLabel('Greeting',{exact:true})).toHaveValue(greeting);
  // A polling refresh must not overwrite an unsaved draft.
  await page.waitForResponse(response=>response.url().endsWith('/api/modules/example/settings') && response.request().method()==='GET');
  await expect(page.getByLabel('Greeting',{exact:true})).toHaveValue(greeting);
  await page.getByRole('button',{name:'Save greeting',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remember greeting',exact:true})).toBeEnabled({timeout:15000});
  await page.getByRole('button',{name:'Remember greeting',exact:true}).click();
  await expect(page.getByText('Task completed. Your greeting is remembered.',{exact:true})).toBeVisible({timeout:15000});
  await expect(page.locator('.embed-preview').getByText(greeting,{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Greeting',{exact:true})).toHaveValue(greeting);
  await expect(page.locator('.embed-preview').getByText(greeting,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1)).toBe(true);
  await page.screenshot({path:`test-results/module-${test.info().project.name}.png`,fullPage:true});
  await page.getByRole('link',{name:/^Modules/}).click();
  await card.getByRole('button',{name:'Disable',exact:true}).click();
  await expect(async () => { await page.getByRole('button', { name: 'Refresh workspace' }).click(); await expect(card.getByText('Disabled',{exact:true})).toBeVisible({timeout:1000}); }).toPass({timeout:15000});
  await card.getByRole('link',{name:'Open module'}).click();
  await expect(page.getByRole('button',{name:'Remember greeting',exact:true})).toBeDisabled();
  expect(errors).toEqual([]);
});

test('overview shares a single workspace refresh and keeps dirty logging settings', async ({ page }) => {
  await page.clock.install();
  const reads: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/') && request.method() === 'GET') reads.push(new URL(request.url()).pathname); });
  await page.goto('/auth/demo');
  await expect(page.getByRole('heading', { name: 'Your community, at a glance.' })).toBeVisible();
  expect(reads).toEqual(['/api/workspace']);
  for (let minute = 1; minute <= 3; minute++) {
    await page.clock.runFor(60000);
    await expect.poll(() => reads.length).toBe(minute + 1);
    await expect(page.getByRole('button', { name: 'Refresh workspace' })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect.poll(() => reads.length).toBe(5);
  expect(reads.every(path => path === '/api/workspace')).toBe(true);
  await page.getByRole('link', { name: 'Configure logging' }).click();
  const toggle = page.getByRole('checkbox', { name: /Message edited/ });
  const previous = await toggle.isChecked(); await toggle.setChecked(!previous);
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  expect(await toggle.isChecked()).toBe(!previous);
  await page.screenshot({ path: `test-results/workspace-budget-${test.info().project.name}.png`, fullPage: true });
});
