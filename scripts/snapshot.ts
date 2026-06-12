/**
 * Visual verification loop: render the app in headless Chrome and capture
 * a screenshot + runtime errors so an agent (or human) can inspect the result
 * without a real webcam or display.
 *
 *   bun run snapshot                 # uses/starts dev server on :5173
 *   bun run snapshot http://127.0.0.1:4173/ out.png
 *
 * Exits non-zero if the page throws uncaught errors, so it can gate `verify`.
 */
import { chromium } from "playwright-core";
import type { Subprocess } from "bun";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const outPath = process.argv[3] ?? ".loop/snapshot.png";
const port = new URL(url).port || "5173";

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let server: Subprocess | null = null;
if (!(await isUp())) {
  console.log(`[snapshot] no server on ${url}, starting vite dev server…`);
  server = Bun.spawn(["bun", "x", "vite", "--port", port, "--strictPort"], {
    cwd: import.meta.dir + "/..",
    stdout: "ignore",
    stderr: "ignore",
  });
  const deadline = Date.now() + 20_000;
  while (!(await isUp())) {
    if (Date.now() > deadline) {
      server.kill();
      console.error("[snapshot] dev server did not come up within 20s");
      process.exit(1);
    }
    await Bun.sleep(300);
  }
}

const pageErrors: string[] = [];
const consoleErrors: string[] = [];

try {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      // fake webcam so HandTracker's getUserMedia doesn't block on permission
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  // force-graph renders into a canvas; give the 3D layout a moment to settle
  await page.waitForSelector("canvas", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: outPath });
  await browser.close();
} finally {
  server?.kill();
}

console.log(`[snapshot] saved ${outPath}`);
if (consoleErrors.length) {
  console.log(`[snapshot] console errors (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 10)) console.log(`  - ${e}`);
}
if (pageErrors.length) {
  console.error(`[snapshot] uncaught page errors (${pageErrors.length}):`);
  for (const e of pageErrors.slice(0, 10)) console.error(`  - ${e}`);
  process.exit(1);
}
