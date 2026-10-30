/**
 * Screenshot sandbox pages at the two reference phone sizes.
 * Usage: node scripts/screenshots.cjs <outDir> <path> [<path>...]
 *   e.g. node scripts/screenshots.cjs shots "/sandbox/highcard?players=4&steps=3&chrome=0"
 * Needs `npm run dev` on http://localhost:5173 (override with BASE_URL).
 * Fails (exit 1) if a page throws, logs a console error, or scrolls horizontally.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const SIZES = [
  { name: "375x667", width: 375, height: 667 },
  { name: "412x915", width: 412, height: 915 },
];
const BASE = process.env.BASE_URL || "http://localhost:5173";

(async () => {
  const [outDir, ...pages] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  let failed = false;
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    for (const p of pages) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(BASE + p, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      const slug = p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
      const file = path.join(outDir, `${slug}__${size.name}.png`);
      await page.screenshot({ path: file });
      const problems = [...errors, ...(overflow ? ["horizontal page scroll"] : [])];
      console.log(`${problems.length ? "FAIL" : "ok  "} ${size.name} ${p} -> ${file}${problems.length ? "\n     " + problems.join("\n     ") : ""}`);
      failed ||= problems.length > 0;
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
