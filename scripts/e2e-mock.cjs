/**
 * End-to-end run of the real app against the offline mock backend (scripts/mock-convex-plugin.ts).
 * For each phone size: a host and two guests (separate browser contexts = separate device tokens)
 * create/join a room, the host adds a bot, edits house rules and starts High Card Duel; everyone
 * plays until game over, the results sheet shows, and the host returns everyone to the lobby.
 *
 * Usage: npx vite --port 5190 &   then   node scripts/e2e-mock.cjs [outDir]
 *   BASE_URL overrides http://localhost:5190. Screenshots go to outDir (default ./shots/e2e).
 * Exits 1 on any page error, console error, horizontal page scroll or failed step.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://localhost:5190";
const OUT = process.argv[2] || path.join(process.cwd(), "shots", "e2e");
const SIZES = [
  { name: "375x667", width: 375, height: 667 },
  { name: "412x915", width: 412, height: 915 },
];
const HAND_SIZE = 2; // set via the house-rules stepper (default 5)

const problems = [];
const fail = (msg) => {
  throw new Error(msg);
};

async function newPlayer(browser, size, label) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const report = (kind, text) => {
    const msg = `${size.name} ${label}: ${kind} ${text.split("\n").find((l) => l.trim() && !/^%[so]$/.test(l.trim())) ?? text}`;
    if (!problems.includes(msg)) problems.push(msg);
  };
  page.on("pageerror", (e) => report("pageerror", e.message));
  page.on("console", (m) => m.type() === "error" && report("console", m.text()));
  page.on("dialog", (d) => d.accept());
  return { ctx, page, label, size };
}

async function shot(p, step) {
  await p.page.waitForTimeout(350); // let sheets/transitions settle
  const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) problems.push(`${p.size.name} ${p.label}: horizontal page scroll at "${step}"`);
  const file = path.join(OUT, `${p.size.name}__${step}__${p.label}.png`);
  await p.page.screenshot({ path: file });
  console.log(`  shot ${file}`);
}

/** Scroll the lobby's inner scroller so `locator` is visible, then screenshot. */
async function shotAt(p, step, locator) {
  await locator.scrollIntoViewIfNeeded();
  await shot(p, step);
}

const playerRows = (page) => page.locator(".gc-player-list > li");

async function waitPlayers(page, n) {
  await page.waitForFunction((n) => document.querySelectorAll(".gc-player-list > li").length === n, n, { timeout: 10_000 });
}

async function runSize(browser, size) {
  console.log(`\n== ${size.name}`);
  const host = await newPlayer(browser, size, "host");
  const guestA = await newPlayer(browser, size, "guestA");
  const guestB = await newPlayer(browser, size, "guestB");
  const people = [host, guestA, guestB];

  // Home -> create room
  await host.page.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(host, "01-home");
  await host.page.getByPlaceholder("e.g. Priya").fill("Asha");
  await host.page.getByRole("button", { name: "Create a room" }).click();
  await host.page.waitForURL(/\/r\/[A-Z]{4}$/, { timeout: 10_000 });
  const code = host.page.url().slice(-4);
  console.log(`  room ${code}`);
  await waitPlayers(host.page, 1);
  await shot(host, "02-lobby-new");

  // Guest A joins from Home with the code
  await guestA.page.goto(BASE + "/", { waitUntil: "networkidle" });
  await guestA.page.getByPlaceholder("e.g. Priya").fill("Ravi");
  await guestA.page.getByLabel("Room code").fill(code.toLowerCase());
  await shot(guestA, "03-home-join");
  await guestA.page.getByRole("button", { name: "Join", exact: true }).click();
  await guestA.page.waitForURL(new RegExp(`/r/${code}$`));

  // Guest B opens the invite link -> join form
  await guestB.page.goto(`${BASE}/r/${code}`, { waitUntil: "networkidle" });
  await guestB.page.getByPlaceholder("Your nickname").waitFor();
  await shot(guestB, "04-join-form");
  await guestB.page.getByPlaceholder("Your nickname").fill("Meera");
  await guestB.page.getByRole("button", { name: "Join", exact: true }).click();

  for (const p of people) await waitPlayers(p.page, 3);

  // Host: pick High Card Duel (hidden in prod, listed in dev), add a bot, edit house rules
  const tile = host.page.getByRole("radio", { name: /High Card Duel/ });
  if ((await tile.getAttribute("aria-checked")) !== "true") await tile.click();
  await host.page.getByRole("button", { name: "+ Bot" }).click();
  for (const p of people) await waitPlayers(p.page, 4);
  const botRow = playerRows(host.page).filter({ hasText: "Robo Raju" });
  if (!(await botRow.count())) fail("bot row missing");
  await shot(host, "05-lobby-players");

  const dec = host.page.getByRole("button", { name: "Decrease Cards per player" });
  await dec.scrollIntoViewIfNeeded();
  while (Number(await host.page.locator(".gc-stepper output").first().textContent()) > HAND_SIZE) await dec.click();
  await host.page.getByRole("radio", { name: "Nobody scores on a tie" }).click();
  await host.page.getByRole("switch").first().click(); // Ace is low
  await shotAt(host, "06-lobby-rules-host", host.page.getByRole("switch").first());

  // Guests see the host's rules (read-only) once the debounced update lands
  await guestA.page.waitForFunction(
    (n) => document.querySelector(".gc-stepper output")?.textContent === String(n),
    HAND_SIZE,
    { timeout: 10_000 },
  );
  await shotAt(guestA, "07-lobby-rules-guest", guestA.page.locator(".gc-settings"));
  await guestA.page.locator(".gc-game-bottom").waitFor();
  await shotAt(guestA, "08-lobby-top-guest", guestA.page.locator(".gc-code-card"));

  // Start
  await host.page.getByRole("button", { name: "Start High Card Duel" }).click();
  for (const p of people) await p.page.locator(".gc-game").first().waitFor({ timeout: 10_000 });
  await shot(host, "09-game-start");
  await shot(guestA, "09-game-start");

  // Refresh rejoins the same seat
  await guestB.page.reload({ waitUntil: "networkidle" });
  await guestB.page.locator(".gc-game").first().waitFor({ timeout: 10_000 });
  if (await guestB.page.getByText("spectating").count()) fail("guestB lost their seat on refresh");

  // Play: every human picks a card each round; the host advances. Bots move via the scheduler.
  let shotPick = false;
  let shotReveal = false;
  const deadline = Date.now() + 60_000;
  while (!(await host.page.getByText("🏆 Game over").isVisible())) {
    if (Date.now() > deadline) fail("game did not finish in 60s");
    for (const p of people) {
      const card = p.page.locator(".gc-hand-row button:not([disabled]):not(.gc-card--dim)").first();
      const play = p.page.getByRole("button", { name: "Play card" });
      if ((await play.count()) && (await card.count())) {
        await card.click();
        if (!shotPick && p === guestA) {
          await shot(p, "10-game-selected");
          shotPick = true;
        }
        if (await play.isEnabled()) await play.click();
      }
    }
    const next = host.page.getByRole("button", { name: "Next round" });
    if (await next.isVisible()) {
      if (!shotReveal) {
        await shot(host, "11-game-reveal-host");
        await shot(guestB, "11-game-reveal-guest");
        shotReveal = true;
      }
      await next.click();
    }
    await host.page.waitForTimeout(300);
  }
  for (const p of people) await p.page.getByText("🏆 Game over").waitFor({ timeout: 10_000 });
  await shot(host, "12-results-host");
  await shot(guestA, "12-results-guest");

  // Guest closes the sheet to see the final table
  await guestA.page.getByRole("button", { name: "See the table" }).click();
  await shot(guestA, "13-final-table-guest");

  // Back to lobby: everyone returns, last game scoreboard shows
  await host.page.getByRole("button", { name: "Back to lobby" }).click();
  for (const p of people) await p.page.getByRole("region", { name: "Last game" }).waitFor({ timeout: 10_000 });
  await shotAt(host, "14-lobby-after-host", host.page.getByRole("region", { name: "Last game" }));
  await shotAt(guestB, "14-lobby-after-guest", guestB.page.getByRole("region", { name: "Last game" }));

  // Host menu sheet
  await host.page.getByRole("button", { name: "Room menu" }).click();
  await shot(host, "15-lobby-menu-host");

  for (const p of people) await p.ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let crashed = null;
  try {
    for (const size of SIZES) await runSize(browser, size);
  } catch (e) {
    crashed = e;
  }
  await browser.close();
  if (crashed) problems.push(`step failed: ${crashed.stack || crashed}`);
  if (problems.length) {
    console.log("\nFAIL\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("\nok: all steps passed");
})();
