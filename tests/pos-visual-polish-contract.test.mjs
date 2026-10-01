import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const posClient = readFileSync("app/pos/pos-desk-client.tsx", "utf8");
const customerDisplayClient = readFileSync(
  "app/pos/customer-display/customer-display-client.tsx",
  "utf8",
);
const turnToneHelperPath = "lib/pos-staff-turn-tone.ts";

async function importTypeScriptModule(path) {
  const tempDir = mkdtempSync(join(tmpdir(), "kingpos-visual-polish-"));
  const outputPath = join(tempDir, "module.mjs");
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
  });

  writeFileSync(outputPath, compiled.outputText, "utf8");

  try {
    return await import(pathToFileURL(outputPath).href);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

const { STAFF_TURN_TONE_LEVEL_COUNT, getStaffTurnToneLevel } =
  await importTypeScriptModule(turnToneHelperPath);

test("staff turn tone helper keeps equal turns together and higher turns stronger", () => {
  const turns = [8, 8, 8, 11];
  const tones = turns.map((turn) => getStaffTurnToneLevel(turn, turns));

  assert.deepEqual(
    tones.slice(0, 3),
    [tones[0], tones[0], tones[0]],
    "Equal large-turn counts should share one intensity.",
  );
  assert.ok(
    tones[3] > tones[0],
    `Higher large-turn count should receive a stronger tone; got ${tones}.`,
  );
  assert.equal(tones[0], 0);
  assert.equal(tones[3], STAFF_TURN_TONE_LEVEL_COUNT - 1);
});

test("staff turn tone helper spans five semantic levels when staff counts are distinct", () => {
  const turns = [8, 9, 10, 11, 12];
  const tones = turns.map((turn) => getStaffTurnToneLevel(turn, turns));

  assert.deepEqual(tones, [0, 1, 2, 3, 4]);
});

test("POS visual hierarchy uses warm service controls and orange primary submit", () => {
  assert.match(posClient, /STAFF_TURN_TONE_CLASSES = \[/);
  assert.match(posClient, /border-cyan-200/);
  assert.match(posClient, /border-lime-200/);
  assert.match(posClient, /border-yellow-300/);
  assert.match(posClient, /border-orange-300/);
  assert.match(posClient, /border-rose-300/);
  assert.match(posClient, /data-pos-staff-tone/);
  assert.match(posClient, /ring-brand-orange/);
  assert.doesNotMatch(posClient, /to-red-700/);
  assert.match(posClient, /aria-label=\{`\$\{member\.display_name\}, \$\{staffTurnCount\} large turns, \$\{member\.turns\.smallTurns\} small turns/);
  assert.doesNotMatch(posClient, /S \{member\.turns\.smallTurns\}/);
  assert.match(posClient, /data-pos-toast-amount/);
  assert.match(posClient, /amount: formatMoney\(submittedTotal\)/);
  assert.match(posClient, /fixed left-1\/2 top-1\/2 z-\[70\]/);
  assert.match(posClient, /-translate-x-1\/2 -translate-y-1\/2/);
  assert.match(posClient, /text-3xl font-black/);
  assert.match(posClient, /bg-white\/78/);
  assert.match(posClient, /backdrop-blur-xl/);
  assert.match(posClient, /overflow-y-auto overflow-x-hidden[\s\S]*data-pos-staff-turn-board/);
  assert.match(posClient, /max-h-\[min\(42dvh,390px\)\]/);
  assert.match(posClient, /grid-cols-\[repeat\(auto-fill,minmax\(96px,112px\)\)\]/);
  assert.match(posClient, /min-h-12 overflow-hidden rounded-lg/);
  assert.match(posClient, /from-\[#fffaf7\][\s\S]*to-brand-orange-soft\/60/);
  assert.match(posClient, /border-brand-orange bg-gradient-to-br from-brand-orange-soft/);
  assert.match(posClient, /from-brand-orange via-\[#ef5d28\] to-brand-orange-hover/);
  assert.doesNotMatch(posClient, /from-teal-600 to-teal-800/);
  assert.doesNotMatch(posClient, /Manual amount/);
});

test("Waiting drawer uses a viewport portal with clamped placement and internal scrolling", () => {
  assert.match(posClient, /import \{ createPortal \} from "react-dom"/);
  assert.match(posClient, /function getWaitingDrawerPlacement/);
  assert.match(posClient, /window\.innerWidth/);
  assert.match(posClient, /window\.innerHeight/);
  assert.match(posClient, /createPortal\(waitingDrawer, document\.body\)/);
  assert.match(posClient, /data-pos-waiting-portal-layer/);
  assert.match(posClient, /window\.addEventListener\("resize", updateWaitingDrawerPlacement\)/);
  assert.match(posClient, /window\.addEventListener\("scroll", updateWaitingDrawerPlacement, true\)/);
  assert.match(posClient, /window\.addEventListener\("keydown", closeWaitingOnEscape\)/);
  assert.match(posClient, /className="fixed inset-0 z-\[45\] pointer-events-none"/);
  assert.match(posClient, /className="fixed z-10 pointer-events-auto flex min-w-0 flex-col overflow-hidden/);
  assert.match(posClient, /style=\{\s*waitingDrawerPlacement \?\? \{/);
  assert.match(posClient, /data-pos-waiting-drawer-scroll/);
});

test("Customer Check-in service cards stay compact but visually tappable", () => {
  assert.match(customerDisplayClient, /data-customer-display-service-grid/);
  assert.match(customerDisplayClient, /md:grid-cols-3/);
  assert.match(customerDisplayClient, /min-h-\[76px\]/);
  assert.match(customerDisplayClient, /from-\[#fffaf7\]/);
  assert.match(customerDisplayClient, /border-brand-orange\/25/);
  assert.match(customerDisplayClient, /from-brand-orange-soft via-white to-amber-50/);
  assert.match(customerDisplayClient, /bg-brand-orange/);
});
