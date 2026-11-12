import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = '/tmp/pickle-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const PHONE = { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TABLET = { viewport: { width: 1180, height: 820 }, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

const errors: string[] = [];
function watch(page: Page, who: string) {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|favicon/i.test(m.text())) errors.push(`${who}: ${m.text()}`); });
}

let admin: { ctx: BrowserContext; page: Page };
let phone: { ctx: BrowserContext; page: Page };
let tablet: { ctx: BrowserContext; page: Page };
async function open(browser: Browser, opts: object, who: string) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); watch(page, who); return { ctx, page };
}
async function signIn(page: Page, user: string, pw: string) {
  await page.goto('/');
  await page.getByLabel('Username').fill(user); await page.getByLabel('Password').fill(pw);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.serial('Pickle Scoring end-to-end', () => {
  test.beforeAll(async ({ browser }) => {
    admin = await open(browser, DESKTOP, 'admin'); phone = await open(browser, PHONE, 'phone'); tablet = await open(browser, TABLET, 'tablet');
  });
  test.afterAll(async () => { for (const c of [admin, phone, tablet]) await c.ctx.close(); });

  test('first-run setup creates the Admin and courts (FR-AUTH-01)', async () => {
    const p = admin.page;
    await p.goto('/');
    await expect(p.getByRole('heading', { name: 'Create the Admin account' })).toBeVisible();
    await p.getByLabel('Username').fill('owner'); await p.getByLabel('Your name').fill('Olivia Owner');
    await p.getByLabel('Password', { exact: true }).fill('owner-pass-1'); await p.getByLabel('Repeat password').fill('owner-pass-1');
    await p.getByRole('button', { name: 'Next' }).click();
    await p.getByLabel('Facility name').fill('Sunset Pickleball'); await p.getByLabel('Number of courts').fill('4');
    await p.getByRole('button', { name: 'Create and sign in' }).click();
    await expect(p.getByRole('heading', { name: "You're all set" })).toBeVisible();
    await p.getByRole('button', { name: 'Open the dashboard' }).click();
    await expect(p.getByRole('heading', { name: 'Which court is this device for?' })).toBeVisible();
    await p.getByRole('button', { name: /Skip/ }).click();
    await expect(p.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(p.getByText('Court 4').first()).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/01-dashboard-admin.png` });
  });

  test('Admin creates Staff accounts in the UI — no limit (FR-AUTH-08)', async () => {
    const p = admin.page;
    await p.goto('/admin/users');
    await expect(p.getByText(/Staff accounts: 0 active \(no limit\)/)).toBeVisible();
    for (const [u, n] of [['maria', 'Maria Lopez'], ['sam', 'Sam Okafor']]) {
      await p.getByRole('button', { name: 'Add user' }).click();
      await p.getByLabel('Username').fill(u); await p.getByLabel('Display name').fill(n);
      await p.getByLabel('Temporary password').fill('staff-pass-1');
      await p.getByLabel('Must change password at first sign-in').uncheck();
      await p.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(p.getByText(`Created ${n}`)).toBeVisible();
    }
    await expect(p.getByText(/Staff accounts: 2 active \(no limit\)/)).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/02-users.png` });
  });

  test('referee signs in on a phone and assigns it to Court 1 (FR-TERM-02)', async () => {
    const p = phone.page;
    await signIn(p, 'maria', 'staff-pass-1');
    await expect(p.getByRole('heading', { name: 'Which court is this device for?' })).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/03-phone-picker.png` });
    await p.getByRole('button', { name: 'Court 1', exact: true }).click();
    await expect(p.getByRole('heading', { name: 'Court 1', exact: true, level: 1 })).toBeVisible();
    await expect(p.getByRole('button', { name: 'New match' })).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/04-phone-idle.png` });
  });

  test('referee runs a match: type first, rules, serve, score, undo (FR-MATCH)', async () => {
    const p = phone.page;
    await p.getByRole('button', { name: 'New match' }).click();
    await expect(p.getByRole('button', { name: 'Next: players' })).toBeDisabled(); // nothing preselected
    await p.getByRole('button', { name: /^Singles/ }).click();
    await p.screenshot({ path: `${SHOTS}/05-phone-wizard.png` });
    await p.getByRole('button', { name: 'Next: players' }).click();
    await p.getByPlaceholder('Player 1').first().fill('Jordan');
    await p.getByRole('button', { name: 'Create and start' }).click();
    await expect(p.getByRole('heading', { name: 'Start match' })).toBeVisible();
    await p.getByRole('button', { name: 'Team A', exact: true }).first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Start match' }).click();
    const rallyA = p.getByRole('button', { name: /RALLY WON — TEAM A/ });
    await expect(rallyA).toBeEnabled();
    await rallyA.click(); await p.waitForTimeout(700); await rallyA.click();
    await expect(p.locator('section[aria-label="Team A 2"]')).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/06-phone-live.png` });
    await p.getByRole('button', { name: 'Undo' }).click();
    await expect(p.locator('section[aria-label="Team A 1"]')).toBeVisible();
    await expect(p.getByText(/Last:.*Undid|Undid/)).toBeVisible();
  });

  test('another device sees the live score within a second (NFR-PERF-02)', async () => {
    const p = admin.page;
    await p.goto('/dashboard');
    const card = p.getByRole('link', { name: /Court 1/ }).first();
    await expect(card).toContainText('In progress');
    await expect(card).toContainText('Jordan');
    await expect(card.getByText('Online')).toBeVisible(); // the phone is Court 1's device
    // score on the phone, watch the admin card change
    const rb = phone.page.getByRole('button', { name: /RALLY WON — TEAM A/ });
    await phone.page.waitForTimeout(700); // the 600 ms double-tap guard must have expired
    await rb.click();
    await expect(phone.page.locator('section[aria-label="Team A 2"]')).toBeVisible(); // the phone itself updated
    await p.screenshot({ path: `${SHOTS}/07a-dashboard-after.png` });
    await expect(card.locator('.tnum').first()).toHaveText('2', { timeout: 1500 });
    await p.screenshot({ path: `${SHOTS}/07-dashboard-live.png` });
  });

  test('End match needs a real press-and-hold plus confirmation and records no winner (FR-MATCH-13)', async () => {
    const p = phone.page;
    await p.getByRole('button', { name: 'More actions' }).click();
    await p.getByRole('button', { name: /End match early/ }).click();
    await p.getByRole('button', { name: 'Players left' }).click();
    const hold = p.getByRole('button', { name: /Hold to end match/ });
    const box = (await hold.boundingBox())!; const x = box.x + box.width / 2, y = box.y + box.height / 2;
    // a quick tap does nothing
    await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(150); await p.mouse.up();
    await expect(p.getByText('Keep holding…')).toBeVisible();
    await expect(p.getByRole('heading', { name: 'End this match?' })).toHaveCount(0);
    // releasing early (1.2 s of a 2 s hold) does nothing either
    await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(1200); await p.mouse.up();
    await expect(p.getByRole('heading', { name: 'End this match?' })).toHaveCount(0);
    // a full hold only opens the confirmation
    await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(2300); await p.mouse.up();
    await expect(p.getByRole('heading', { name: 'End this match?' })).toBeVisible();
    await expect(p.getByText('No winner will be recorded.')).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/08-phone-end-confirm.png` });
    await p.getByRole('button', { name: 'Confirm end' }).click();
    await expect(p.getByText(/MATCH ENDED EARLY/)).toBeVisible();
    await expect(p.getByText('No winner is recorded')).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/09-phone-ended-early.png` });
  });

  test('reload and reconnection return to the same court and state (FR-TERM-03)', async () => {
    const p = phone.page;
    await p.reload();
    await expect(p.getByRole('heading', { name: 'Court 1', exact: true, level: 1 })).toBeVisible();
    await expect(p.getByText(/MATCH ENDED EARLY/)).toBeVisible();
    // drop the network and bring it back
    await phone.ctx.setOffline(true);
    await expect(p.getByRole('alert').filter({ hasText: /Reconnecting|restarting/ })).toBeVisible({ timeout: 20_000 });
    await expect(p.getByRole('button', { name: 'New match' })).toBeDisabled(); // scoring/creating locked while offline
    await phone.ctx.setOffline(false);
    await expect(p.getByRole('alert').filter({ hasText: /Reconnecting|restarting/ })).toHaveCount(0, { timeout: 25_000 });
    await expect(p.getByRole('button', { name: 'New match' })).toBeEnabled();
  });

  test('Admin books a court; Staff see it read-only (FR-BOOK)', async () => {
    const a = admin.page;
    await a.goto('/bookings');
    await expect(a.getByRole('heading', { name: 'Booking Schedule' })).toBeVisible();
    // go to tomorrow so the test never depends on the time of day
    await a.getByRole('button', { name: 'Next' }).click();
    await a.getByRole('button', { name: 'New booking' }).click();
    await a.getByLabel('Booked by').fill('Chen family');
    await a.getByLabel('Start').selectOption('1080'); await a.getByLabel('End').selectOption('1140'); // 18:00–19:00
    await a.getByRole('button', { name: 'Save' }).click();
    await expect(a.getByRole('button', { name: /Chen family/ })).toBeVisible();
    // an overlapping booking is rejected with a clear message
    await a.getByRole('button', { name: 'New booking' }).click();
    await a.getByLabel('Booked by').fill('Overlap'); await a.getByLabel('Start').selectOption('1110'); await a.getByLabel('End').selectOption('1170');
    await a.getByRole('button', { name: 'Save' }).click();
    await expect(a.getByText(/already booked/)).toBeVisible();
    await a.getByRole('button', { name: 'Cancel' }).click();
    await a.screenshot({ path: `${SHOTS}/10-bookings-admin.png` });

    const t = tablet.page;
    await signIn(t, 'sam', 'staff-pass-1');
    await t.getByRole('button', { name: /Skip/ }).click();
    await t.goto('/bookings');
    await t.getByRole('button', { name: 'Next' }).click();
    await expect(t.getByText('View only')).toBeVisible();
    await expect(t.getByRole('button', { name: 'New booking' })).toHaveCount(0);
    await t.getByRole('button', { name: /Chen family/ }).click();
    await expect(t.getByRole('heading', { name: /Booking B-/ })).toBeVisible();
    await expect(t.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    await t.screenshot({ path: `${SHOTS}/11-bookings-staff.png` });
    await t.keyboard.press('Escape');
  });

  test('Staff see every area but no Administration (FR §1.1)', async () => {
    const t = tablet.page;
    await t.goto('/dashboard');
    for (const n of ['Dashboard', 'Booking Schedule', 'Court Management', 'Game Histories', 'Players']) await expect(t.getByRole('navigation', { name: 'Main' }).first().getByText(n)).toBeVisible();
    await expect(t.getByText('Administration')).toHaveCount(0);
    await t.goto('/admin/users');
    await expect(t).toHaveURL(/\/dashboard$/);
    await t.goto('/courts');
    await expect(t.getByRole('button', { name: 'Add court' })).toHaveCount(0);
    await expect(t.getByRole('button', { name: 'Number of courts' })).toHaveCount(0);
    await expect(t.getByText('View only')).toBeVisible();
  });

  test('Players page lists typed names, never default labels; histories open (FR-PLAYER-08/09)', async () => {
    const t = tablet.page;
    // play a quick completed singles match on Court 2 with typed names through the API (same session as the tablet)
    const api = t.context().request;
    const H = { 'x-pickle-client': '1' };
    const created = await (await api.post('/api/v1/matches', { headers: H, data: { courtId: 2, playType: 'singles', players: [{ team: 'A', slot: 1, displayName: 'Riley' }, { team: 'B', slot: 1, displayName: 'Casey' }] } })).json();
    let v = created.snapshot.match.version; const id = created.snapshot.match.id;
    const cmd = async (type: string, payload: object) => { const r = await (await api.post(`/api/v1/matches/${id}/commands`, { headers: H, data: { commandId: `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`, expectedVersion: v, type, payload } })).json(); v = r.snapshot.match.version; return r; };
    await cmd('START_MATCH', { servingTeam: 'A' });
    for (let i = 0; i < 11; i++) await cmd('RALLY_WON', { team: 'A' });
    await cmd('CONFIRM_MATCH_END', {});
    await t.goto('/players');
    await expect(t.getByRole('link', { name: 'Riley' })).toBeVisible();
    await expect(t.getByRole('row', { name: /Riley.*Typed name/ })).toBeVisible();
    await expect(t.getByText(/^Player [12]$/)).toHaveCount(0);
    await t.getByRole('link', { name: 'Riley' }).click();
    await expect(t.getByText(/Grouped by the name as typed/)).toBeVisible();
    await expect(t.getByRole('cell', { name: 'Won' })).toBeVisible();
    await expect(t.getByRole('button', { name: 'Add to directory' })).toHaveCount(0); // Staff cannot register players
    await t.screenshot({ path: `${SHOTS}/12-player-history.png` });
    // Admin can
    const a = admin.page;
    await a.goto('/players'); await a.getByRole('link', { name: 'Riley' }).click();
    await a.getByRole('button', { name: 'Add to directory' }).click();
    await expect(a.getByText(/This will link 1 past match/)).toBeVisible();
    await a.getByRole('dialog').getByRole('button', { name: 'Add to directory' }).click();
    await expect(a.getByText('Registered').first()).toBeVisible();
  });

  test('Game Histories show the ended-early and completed matches with timelines', async () => {
    const a = admin.page;
    await a.goto('/history');
    await expect(a.getByText('Ended early – Players left')).toBeVisible();
    await expect(a.locator('td').getByText('Completed').first()).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/13-history.png` });
    await a.getByText('Ended early – Players left').click();
    await expect(a.getByText(/The score is preserved and no winner is recorded/)).toBeVisible();
    await expect(a.getByText('Event timeline')).toBeVisible();
    await expect(a.getByText(/Ended early – players left/i).first()).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/14-match-detail.png` });
  });

  test('analytics tab renders reports for the Admin', async () => {
    const a = admin.page;
    await a.goto('/dashboard');
    await a.getByRole('tab', { name: 'Analytics' }).click();
    await expect(a.getByText('Match volume')).toBeVisible();
    await a.getByRole('tab', { name: 'Utilization' }).click();
    await expect(a.getByText('Court utilization')).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/15-analytics.png` });
  });

  test('Open Play: 20 players on 4 courts, courts start one at a time, the next round waits for the last court', async () => {
    const a = admin.page, p = phone.page;
    const api = a.context().request; const H = { 'x-pickle-client': '1' };
    // Admin creates the session in the UI and sees the plan before starting
    await a.goto('/open-play');
    await a.getByRole('button', { name: 'New session' }).click();
    // Step 1 Session setup. Only the first step's fields are on screen.
    await expect(a.getByRole('button', { name: /^3\s*Players/ })).toBeDisabled(); // a step opens once the earlier ones are filled in (no court yet)
    await expect(a.getByRole('checkbox', { name: 'Court 1' })).toHaveCount(0);
    await a.getByLabel('Session name').fill('Friday Open Play');
    // session length can be entered in hours or minutes
    await a.getByLabel('Session length unit').selectOption('minutes');
    await expect(a.getByLabel('Session length', { exact: true })).toHaveValue('120');
    await a.getByLabel('Session length unit').selectOption('hours');
    await expect(a.getByLabel('Session length', { exact: true })).toHaveValue('2');
    await a.getByRole('button', { name: /^Next: Courts to use/ }).click();
    // Step 2 Courts to use: Next needs at least one court
    await expect(a.getByLabel('Session name')).toHaveCount(0);
    await expect(a.getByRole('button', { name: /^Next: Players/ })).toBeDisabled();
    for (const n of [1, 2, 3, 4]) await a.getByRole('checkbox', { name: `Court ${n}` }).check();
    await a.screenshot({ path: `${SHOTS}/16a-openplay-courts-step.png` });
    await a.getByRole('button', { name: /^Next: Players/ }).click();
    // Step 3 Players
    // players: 16 from a CSV (quoted fields, optional Team) and 4 from an .xlsx
    const letters = Array.from({ length: 16 }, (_, i) => String.fromCharCode(65 + i));
    const csv = 'First Name,Last Name,Team\r\n' + letters.map((l, i) => `"Player ${l}",Smith,${i % 2 ? '"Red, Home"' : ''}`).join('\r\n');
    await a.getByLabel('Import players file').setInputFiles({ name: 'players.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(a.getByText(/Imported 16 players/)).toBeVisible();
    await a.getByLabel('Import players file').setInputFiles('e2e/fixtures/players.xlsx');
    await expect(a.getByText(/Imported 4 players/)).toBeVisible();
    await expect(a.getByLabel('Team 2', { exact: true })).toHaveValue('Red, Home');
    await expect(a.getByLabel('First name 17', { exact: true })).toHaveValue('Quinn');
    const plan = a.getByText(/What to expect with 20 players on 4 courts/).locator('..');
    await expect(plan).toContainText('16'); await expect(plan).toContainText('4');
    await a.screenshot({ path: `${SHOTS}/16-openplay-create.png` });
    await a.getByRole('button', { name: 'Create session' }).click();
    await expect(a.getByRole('button', { name: 'Start session' })).toBeEnabled();
    await a.getByRole('button', { name: 'Start session' }).click();
    await expect(a.getByText('Court 4').first()).toBeVisible();
    const cards = a.getByTestId('game-card');
    await expect(cards.filter({ hasText: 'Ready to start' })).toHaveCount(4);
    const sid = Number(/open-play\/(\d+)/.exec(a.url())![1]);
    const session = async () => (await (await api.get(`/api/v1/open-play/${sid}`)).json());
    let s = await session();
    expect(s.currentRound.number).toBe(1);
    expect(s.currentRound.games).toHaveLength(4);
    expect(s.currentRound.waiting).toHaveLength(4);
    expect(s.players.find((x: any) => x.name === 'Quinn Tanaka')).toMatchObject({ firstName: 'Quinn', lastName: 'Tanaka', team: 'Blue' });
    // Staff phone (Court 1's device): starts its own game; its own clock begins now
    await p.goto('/courts/1');
    await expect(p.getByText(/Round 1 — start when all four are on court/)).toBeVisible();
    await p.getByRole('button', { name: 'Start game' }).click();
    await p.getByRole('button', { name: 'Team A', exact: true }).first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Start match' }).click();
    await expect(p.getByRole('button', { name: /RALLY WON — TEAM A/ })).toBeEnabled();
    await expect(cards.filter({ hasText: 'Playing' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Ready to start' })).toHaveCount(3);
    await a.screenshot({ path: `${SHOTS}/17-openplay-session.png` });
    // The next-round bracket already names an opponent for each waiting player (4 wait now), and flags games still undecided
    const bracket = a.getByTestId('next-bracket');
    await expect(bracket).toContainText('Round 2 bracket');
    await expect(bracket.getByTestId('bracket-game')).toHaveCount(4);
    await expect(bracket.getByText('Waiting now', { exact: true })).toHaveCount(4);
    await expect(bracket.getByText(/Court \d not decided|Leading · Court \d|Trailing · Court \d/).first()).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/17a-openplay-bracket.png`, fullPage: true });
    // phone layout: stacked, no lines, no sideways scroll
    await p.goto(`/open-play/${Number(/open-play\/(\d+)/.exec(a.url())![1])}`);
    await expect(p.getByTestId('next-bracket').getByTestId('bracket-game')).toHaveCount(4);
    expect(await p.evaluate(() => { const m = document.querySelector('main')!; return Math.max(m.scrollWidth - m.clientWidth, document.documentElement.scrollWidth - window.innerWidth); })).toBeLessThanOrEqual(1);
    await p.getByTestId('next-bracket').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/17b-openplay-bracket-phone.png` });
    await p.goto('/courts/1'); // back to the court console
    await expect(p.getByRole('button', { name: /RALLY WON — TEAM A/ })).toBeEnabled();
    // the TV board while Court 1 is playing and the others are still waiting to start
    const tv = await a.context().browser()!.newContext({ viewport: { width: 1920, height: 1080 }, storageState: await a.context().storageState() });
    const tvp = await tv.newPage(); watch(tvp, 'tv');
    await tvp.goto(`/open-play/${sid}/board`);
    await tvp.getByRole('button', { name: 'Skip – use as a normal computer' }).click(); // once-per-session court picker
    await expect(tvp.getByText('Live', { exact: true }).first()).toBeVisible();
    await expect(tvp.getByText(/\d\d:\d\d left/).first()).toBeVisible();
    await tvp.screenshot({ path: `${SHOTS}/17c-openplay-board-live.png` });
    await tv.close();
    // Staff cannot control sessions
    const staffApi = tablet.page.context().request;
    expect((await staffApi.post(`/api/v1/open-play/${sid}/end`, { headers: H, data: {} })).status()).toBe(403);
    // the other courts start later, one by one; each game is won by the serving team A (side-out scoring)
    s = await session();
    const cmd = async (matchId: number, type: string, payload: object, v: number) => { const r = await (await api.post(`/api/v1/matches/${matchId}/commands`, { headers: H, data: { commandId: `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`, expectedVersion: v, type, payload } })).json(); return r.snapshot.match.version as number; };
    const games = s.currentRound.games as { id: number; matchId: number; courtName: string }[];
    const versionOf = async (id: number) => (await (await api.get(`/api/v1/matches/${id}`)).json()).snapshot.version as number;
    for (const g of games.slice(1)) {
      let v = await versionOf(g.matchId);
      v = await cmd(g.matchId, 'START_MATCH', { servingTeam: 'A' }, v);
    }
    await expect(cards.filter({ hasText: 'Playing' })).toHaveCount(4);
    // Court 1 finishes first (11 rallies on the phone's court via the API)
    {
      let v = await versionOf(games[0].matchId);
      for (let i = 0; i < 11; i++) v = await cmd(games[0].matchId, 'RALLY_WON', { team: 'A' }, v);
    }
    await expect(p.getByText('GAME OVER')).toBeVisible();
    await p.getByRole('button', { name: 'Confirm result' }).click();
    await expect(p.getByText('Waiting for the other courts')).toBeVisible();
    await expect(p.getByText('Court 2').first()).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/18-openplay-court-waiting.png` });
    s = await session();
    expect(s.currentRound.number).toBe(1); // no new round yet: three courts are still playing
    for (const g of games.slice(1)) {
      let v = await versionOf(g.matchId);
      for (let i = 0; i < 11; i++) v = await cmd(g.matchId, 'RALLY_WON', { team: 'A' }, v);
    }
    // all four decided; results confirm after 15 s. The session was created with "Press Begin" (the default), so Round 2 is NOT drawn
    // by itself: the Admin sees "Ready for Round 2" and presses Begin. The TV shows Round 1 as complete meanwhile.
    await expect(a.getByTestId('begin-panel')).toBeVisible({ timeout: 45_000 });
    await expect(a.getByTestId('begin-panel')).toContainText('Round 1 is complete');
    s = await session(); expect(s.currentRound).toBeNull(); expect(s.awaitingBegin).toBe(true); expect(s.roundCount).toBe(1);
    const tv2 = await a.context().browser()!.newContext({ viewport: { width: 1920, height: 1080 }, storageState: await a.context().storageState() });
    const tvq = await tv2.newPage(); watch(tvq, 'tv-awaiting');
    await tvq.goto(`/open-play/${sid}/board`);
    await tvq.getByRole('button', { name: 'Skip – use as a normal computer' }).click(); // once-per-session court picker
    await expect(tvq.getByTestId('tv-awaiting')).toContainText('Round 2 begins when the Admin presses Begin');
    await expect(tvq.getByTestId('tv-bracket')).toContainText('Locked');
    await tvq.screenshot({ path: `${SHOTS}/18a-board-awaiting-begin.png` });
    await tv2.close();
    await a.getByTestId('begin-panel').screenshot({ path: `${SHOTS}/18b-begin-panel.png` });
    // Edit result: a mis-recorded score is fixed by the Admin before the next round (Court 1's 11–0 was really 9–11, so the winner flips)
    const card1 = a.getByTestId('game-card').filter({ hasText: 'Court 1' }).first();
    await card1.getByRole('button', { name: 'Edit result…' }).click();
    const dlg = a.getByRole('dialog');
    await dlg.locator('input[type="number"]').nth(0).fill('9'); await dlg.locator('input[type="number"]').nth(1).fill('11');
    await expect(dlg.getByText('Winner, from the score:')).toBeVisible();                      // read from the score, nothing to choose
    await expect(dlg.getByRole('button', { name: 'Save the edit' })).toBeDisabled();           // a reason is required
    await dlg.getByLabel('Why is it being edited?').fill('Staff entered the score the wrong way round');
    await dlg.getByRole('button', { name: 'Save the edit' }).click();
    await expect(card1).toContainText('edited');
    s = await session();
    expect(s.rounds[0].games.find((g: any) => g.courtName === 'Court 1')).toMatchObject({ scoreA: 9, scoreB: 11, winner: 'B', corrected: true });
    // Staff cannot begin it
    expect((await staffApi.post(`/api/v1/open-play/${sid}/begin`, { headers: H, data: {} })).status()).toBe(403);
    await a.getByRole('button', { name: 'Begin Round 2', exact: true }).click();
    await expect(async () => { s = await session(); expect(s.currentRound.number).toBe(2); }).toPass({ timeout: 15_000, intervals: [500] });
    expect(s.currentRound.games).toHaveLength(4);
    // everyone who sat out round 1 plays round 2
    const r1 = s.rounds.find((r: any) => r.number === 1);
    const waited = r1.waiting.map((x: any) => x.name).sort();
    const playing2 = s.currentRound.games.flatMap((g: any) => [...g.teamA, ...g.teamB]).map((x: any) => x.name);
    for (const n of waited) expect(playing2).toContain(n);
    await expect(a.getByText(/Round\s*2|^2$/).first()).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/19-openplay-round2.png` });
    // the TV board is read-only and shows standings
    await a.goto(`/open-play/${sid}/board`);
    await expect(a.getByRole('heading', { name: 'Friday Open Play' })).toBeVisible();
    await expect(a.getByText('Standings')).toBeVisible();
    // ...and draws the bracket: this round's courts feed the projected next round
    await expect(a.getByTestId('tv-bracket')).toContainText('Up next');
    await expect(a.getByTestId('tv-bracket')).toContainText('Round 3');
    await expect(a.getByTestId('tv-bracket').getByTestId('bracket-game')).toHaveCount(4);
    await expect(a.getByTestId('game-card')).toHaveCount(4); // the courts (with scores and clocks) are the left side of the bracket
    await expect(a.getByRole('img', { name: 'Waiting now' }).first()).toBeVisible(); // each waiting player carries a chip in the game they play next
    // a third column for the round after next: slots only, never guessed names
    await expect(a.getByTestId('tv-bracket')).toContainText('After next');
    await expect(a.getByTestId('tv-bracket').getByTestId('pending-game')).toHaveCount(4);
    // players are named only when certain: the 4 waiting players have names, the 12 coming off undecided games read "Undecided"
    await expect(a.getByTestId('tv-bracket').getByText('Undecided', { exact: true })).toHaveCount(12);
    await expect(a.getByTestId('bracket-game').getByRole('img', { name: 'Waiting now' })).toHaveCount(4); // cards only, not the legend
    // the four newcomers are paired with each other on Court 1 (fully named), the rest of the round is undecided
    await expect(a.getByTestId('bracket-game').first()).not.toContainText('Undecided');
    await expect(a.getByTestId('bracket-game').first().getByRole('img', { name: 'Waiting now' })).toHaveCount(4);
    await expect(a.getByTestId('bracket-game').nth(1)).toContainText('Undecided');
    await expect(a.getByTestId('tv-bracket').getByText('Waiting for the winner/loser')).toHaveCount(8); // two teams per game, four games
    await expect(a.getByTestId('tv-bracket')).not.toContainText('Forecast');
    await expect(a.getByTestId('next-chevrons')).toHaveCount(8); // the ">>>" mark between each court's game now and next, and next and after next
    expect(await a.getByTestId('next-chevrons').first().locator('.chev').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('chev-wave'); // animated (a still screenshot cannot show it)
    await expect(a.getByText('Waiting now', { exact: true })).toHaveCount(0); // there is no separate waiting box on the TV
    await expect(a.getByTestId('tv-bracket').getByText(/^Court [1-4]$/)).toHaveCount(12); // one row per court, three columns: now, next, after next
    await expect(a.getByRole('progressbar', { name: 'Session time used' })).toBeVisible();
    // the TV board is light like everything else
    expect(await a.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    expect(await a.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(248, 255, 239)');
    await a.screenshot({ path: `${SHOTS}/20-openplay-board.png` });
    await a.setViewportSize({ width: 1920, height: 1080 }); // a typical TV
    await a.screenshot({ path: `${SHOTS}/20a-openplay-board-tv.png` });
    await a.setViewportSize({ width: 1440, height: 900 });
    // Admin ends the session: the games in progress are ended and standings are final
    await a.goto(`/open-play/${sid}`);
    await a.getByRole('button', { name: 'End session' }).click();
    await a.getByRole('button', { name: /End everything now/ }).click();
    await expect(a.getByRole('heading', { name: 'Friday Open Play' })).toBeVisible();
    await expect(a.getByText('Finished', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(a.getByText('Final standings', { exact: true })).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/21-openplay-final.png` });
    // Game Histories can filter to Open Play games
    await a.goto('/history');
    await a.getByLabel('Kind').selectOption('1');
    await expect(a.getByText('Open Play').first()).toBeVisible();
  });

  test('Settings times use a 12-hour AM/PM picker and save as 24-hour values', async () => {
    const a = admin.page;
    await a.goto('/admin/settings');
    await expect(a.locator('input[type="time"]')).toHaveCount(0);
    const closes = a.getByRole('group', { name: 'Monday closes' });
    await expect(closes.getByLabel('Monday closes AM or PM')).toHaveValue('PM');
    await expect(closes.getByLabel('Monday closes hour')).toHaveValue('10'); // default 22:00 shows as 10 PM
    await closes.getByLabel('Monday closes hour').selectOption('9');
    await a.locator('button:not([disabled])').filter({ hasText: /^Save$/ }).click(); // only the edited section is enabled
    const saved = await (await a.context().request.get('/api/v1/settings', { headers: { 'x-pickle-client': '1' } })).json();
    expect(saved.operatingHours['1'].close).toBe('21:00');
    await a.reload();
    await expect(a.getByRole('group', { name: 'Monday closes' }).getByLabel('Monday closes hour')).toHaveValue('9');
    await a.screenshot({ path: `${SHOTS}/22-settings-12h.png` });
  });

  test('Peecool brand: light theme only, brand fonts and logo load, no horizontal overflow at seven sizes', async ({ browser }) => {
    const sizes = [['wide', 1920, 1080], ['laptop', 1366, 768], ['tablet-land', 1280, 800], ['tablet-port', 820, 1180], ['phone', 390, 844], ['phone-small', 360, 640], ['phone-land', 844, 390]] as const;
    const paths = ['/dashboard', '/courts', '/bookings', '/history', '/players', '/open-play', '/admin/settings', '/admin/users'];
    for (const [name, width, height] of sizes) {
      const ctx = await browser.newContext({ viewport: { width, height }, storageState: await admin.ctx.storageState() });
      const p = await ctx.newPage(); watch(p, `brand-${name}`);
      await p.goto('/dashboard');
      await p.getByRole('button', { name: 'Skip – use as a normal computer' }).click(); // once-per-session court picker
      for (const path of paths) {
        await p.goto(path);
        await expect(p.getByRole('heading', { level: 1 }).first()).toBeVisible();
        const over = await p.evaluate(() => { const m = document.querySelector('main') ?? document.body; return Math.max(m.scrollWidth - m.clientWidth, document.documentElement.scrollWidth - window.innerWidth); });
        expect(over, `${name} ${path} horizontal overflow`).toBeLessThanOrEqual(1);
      }
      await p.goto('/dashboard');
      await expect(p.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
      expect(await p.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
      expect(await p.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(248, 255, 239)');
      await p.evaluate(() => document.fonts.ready);
      const loaded = await p.evaluate(async () => (await Promise.all([document.fonts.load('700 40px Geist', '0123'), document.fonts.load('400 14px "Geist Mono"', 'ab1')])).map((l) => l.length));
      expect(loaded, 'Geist and Geist Mono are bundled and load').toEqual([1, 1]);
      await p.screenshot({ path: `${SHOTS}/30-brand-dashboard-${name}.png` });
      await p.goto('/courts'); await expect(p.getByRole('heading', { name: 'Court Management', level: 1 })).toBeVisible(); await p.screenshot({ path: `${SHOTS}/31-brand-courts-${name}.png` });
      await ctx.close();
    }
    const out = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const lp = await out.newPage();
    await lp.goto('/');
    await expect(lp.getByRole('img', { name: 'Peecool' })).toBeVisible();
    await expect(lp).toHaveTitle('Peecool');
    expect(await lp.evaluate(() => (document.querySelector('img[alt="Peecool"]') as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await lp.screenshot({ path: `${SHOTS}/32-brand-login.png` });
    await out.close();
  });

  test('Connect a phone or tablet: Admin and Staff both get the address and QR code', async () => {
    // Admin: its own page and the panel in Settings
    const a = admin.page;
    await a.goto('/connect');
    await expect(a.getByRole('heading', { name: 'Connect a phone or tablet', level: 1 })).toBeVisible();
    await expect(a.getByTestId('connect-qr').locator('svg')).toBeVisible();
    const url = (await a.getByTestId('connect-url').textContent())!;
    expect(url).toMatch(/^http:\/\/[^/]+:18181$/);           // the port this browser used, so the link works for the phone too
    await expect(a.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(a.getByTestId('seen-devices')).toContainText('Is the phone getting through?');
    await expect(a.getByTestId('seen-devices')).toContainText('Nothing has reached this computer yet');   // every browser in this test is on the server itself, which is never listed
    await a.goto('/admin/settings');
    await expect(a.getByTestId('connect-card')).toBeVisible();
    expect(await a.getByTestId('connect-url').textContent()).toBe(url);
    // Staff: reachable from the account menu, same address
    const t = tablet.page;
    await t.goto('/dashboard');
    await t.getByRole('button', { name: /Sam/ }).click();
    await t.getByRole('menuitem', { name: 'Connect a phone or tablet' }).click();
    await expect(t).toHaveURL(/\/connect$/);
    await expect(t.getByTestId('connect-qr').locator('svg')).toBeVisible();
    expect(await t.getByTestId('connect-url').textContent()).toMatch(/^http:\/\/[^/]+:18181$/);
    await t.screenshot({ path: `${SHOTS}/50-connect-staff.png` });
    await a.goto('/connect'); await a.screenshot({ path: `${SHOTS}/51-connect-admin.png` });
    // the staff tablet goes back to where it was
    await t.goto('/dashboard');
  });

  test('Court scoring screen on phones: nothing overlaps or is cut off on a small phone, a normal phone or a landscape phone', async ({ browser }) => {
    const api = admin.ctx.request; const H = { 'x-pickle-client': '1' };
    // a live doubles game with long names on the first free court
    let match: any = null; let courtId = 0;
    for (const id of [1, 2, 3, 4]) {
      const r = await api.post('/api/v1/matches', { headers: H, data: { courtId: id, playType: 'doubles', players: ['Alexandria Fernandez-Santos', 'Bartholomew Nguyen', 'Christopher Dela Cruz', 'Dominique Villanueva'].map((n, i) => ({ team: i < 2 ? 'A' : 'B', slot: (i % 2) + 1, displayName: n })) } });
      if (r.status() === 201) { match = (await r.json()).snapshot.match; courtId = id; break; }
    }
    expect(match, 'a court was free for the layout test').toBeTruthy();
    expect((await api.post(`/api/v1/matches/${match.id}/commands`, { headers: H, data: { commandId: 'cmd-layout-test-0000001', expectedVersion: match.version, type: 'START_MATCH', payload: { servingTeam: 'A' } } })).status()).toBe(200);
    for (const [name, width, height] of [['phone-small', 360, 640], ['phone', 390, 844], ['phone-land', 844, 390]] as const) {
      const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await admin.ctx.storageState() });
      const p = await ctx.newPage(); watch(p, `layout-${name}`);
      await p.goto(`/courts/${courtId}?fs=1`);
      const skip = p.getByRole('button', { name: 'Skip – use as a normal computer' }); if (await skip.isVisible().catch(() => false)) await skip.click();
      await expect(p.getByRole('button', { name: /RALLY WON — TEAM A/ })).toBeVisible();
      const g = await p.evaluate(() => {
        const r = (e: Element | null) => { const b = e!.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; };
        const panels = [...document.querySelectorAll('section[aria-label]')].map((s) => {
          const header = s.querySelector('h2')!.parentElement!.parentElement!;       // team name, player names, serving tag
          return { header: r(header), score: r(s.querySelector('.score-pop')), rally: r(s.querySelector('button')), panel: r(s) };
        });
        const more = document.querySelector('[aria-label="More actions"]');
        const call = [...document.querySelectorAll('footer p')].find((el) => /\d – \d/.test(el.textContent ?? ''))!;
        return { panels, more: r(more), call: r(call), callFont: parseFloat(getComputedStyle(call).fontSize), vw: window.innerWidth, vh: window.innerHeight, docW: document.documentElement.scrollWidth };
      });
      for (const [i, s] of g.panels.entries()) {
        expect(s.score.top, `${name} panel ${i}: the score starts below the names`).toBeGreaterThanOrEqual(s.header.bottom - 1);
        expect(s.score.bottom, `${name} panel ${i}: the score ends above the Rally button`).toBeLessThanOrEqual(s.rally.top + 1);
        expect(s.rally.bottom, `${name} panel ${i}: the Rally button is on screen`).toBeLessThanOrEqual(g.vh + 1);
      }
      expect(g.more.right, `${name}: the More button is inside the screen`).toBeLessThanOrEqual(g.vw + 0.5);
      expect(g.more.bottom, `${name}: the footer is on screen`).toBeLessThanOrEqual(g.vh + 1);
      expect(g.call.height, `${name}: the call is on one line`).toBeLessThan(g.callFont * 1.5);
      expect(g.docW, `${name}: no sideways scroll`).toBeLessThanOrEqual(g.vw + 1);
      await p.screenshot({ path: `${SHOTS}/60-console-${name}.png` });
      await ctx.close();
    }
    // Court Management list: compact by default on a phone, and the choice is remembered
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await admin.ctx.storageState() });
    const p = await ctx.newPage(); watch(p, 'layout-courts');
    await p.goto('/courts');
    const skip = p.getByRole('button', { name: 'Skip – use as a normal computer' }); if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(p.getByRole('tab', { name: 'Compact' })).toHaveAttribute('aria-selected', 'true');
    const compactH = (await p.locator('[data-density="compact"]').first().boundingBox())!.height;
    await p.getByRole('tab', { name: 'Comfortable' }).click();
    await expect(p.locator('[data-density="compact"]')).toHaveCount(0);
    await p.reload();
    await expect(p.getByRole('tab', { name: 'Comfortable' })).toHaveAttribute('aria-selected', 'true');   // remembered on this device
    const roomyH = (await p.locator('a[href^="/courts/"]').first().boundingBox())!.height;
    expect(compactH, 'a compact card is clearly shorter than a comfortable one').toBeLessThan(roomyH * 0.8);
    await ctx.close();
    // end the layout-test match so the courts are free again
    await api.post(`/api/v1/matches/${match.id}/commands`, { headers: H, data: { commandId: 'cmd-layout-test-0000002', expectedVersion: match.version + 1, type: 'END_MATCH', payload: { reason: 'other', confirmed: true } } });
  });

  test('Sign out returns to the login page without a refresh', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: await admin.ctx.storageState() });
    const p = await ctx.newPage(); watch(p, 'signout');
    await p.goto('/dashboard');
    await p.getByRole('button', { name: 'Skip – use as a normal computer' }).click();
    await expect(p.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await p.getByRole('button', { name: /Olivia Owner/ }).click();
    await p.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(p.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(p.getByLabel('Username')).toBeVisible();
    await ctx.close();
  });

  test('no unexpected browser errors were logged', () => {
    expect(errors).toEqual([]);
  });
});
