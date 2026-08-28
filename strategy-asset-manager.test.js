const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "strategy/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "strategy/strategy-comparison-v1.css"), "utf8");
const source = fs.readFileSync(path.join(root, "strategy/strategy-comparison-v1.js"), "utf8");

function helpers() {
  const start = source.indexOf("  function number(");
  const end = source.indexOf("  function percent(", start);
  assert.ok(start >= 0 && end > start, "comparison helper block must remain extractable");
  return new Function(`
    const DEFAULT_ASSETS = Object.freeze(["BTC", "ETH", "HYPE"]);
    const MAX_ASSETS = 8;
    const STORAGE_KEY = "mango.fixed-otm.assets.v1";
    const $ = () => ({ value: "" });
    ${source.slice(start, end)}
    return { normalizeTicker, readAssets, settingsValid, aggregate };
  `)();
}

test("fixed OTM scan exposes a visible asset manager", () => {
  for (const token of [
    'id="compareAssetManagerTitle"',
    'id="compareAssetChips"',
    'id="compareTickerInput"',
    'id="compareAssetFeedback"',
    "增加美股",
    "最多同时比较 8 个资产",
    "Alpaca Basic Indicative",
  ]) {
    assert.ok(html.includes(token), `missing asset-manager marker: ${token}`);
  }
  assert.ok(css.includes(".compare-asset-manager"));
  assert.ok(css.includes("@media (max-width: 620px)"));
});

test("asset selection keeps the three defaults, validates tickers, and caps the list", () => {
  const { normalizeTicker, readAssets } = helpers();
  assert.equal(normalizeTicker(" pdd "), "PDD");
  assert.equal(normalizeTicker("BRK.B"), "BRK.B");
  assert.equal(normalizeTicker("not valid"), "");
  const storage = {
    getItem: () => JSON.stringify(["PDD", "pdd", "AAPL", "MSFT", "TSLA", "NVDA", "META", "AMZN"]),
  };
  assert.deepEqual(readAssets(storage), ["BTC", "ETH", "HYPE", "PDD", "AAPL", "MSFT", "TSLA", "NVDA"]);
});

test("fixed OTM aggregation treats authenticated U.S. indicative data as research-comparable", () => {
  const { aggregate, settingsValid } = helpers();
  const row = (strike, days, annualYield, delta, iv = 45) => ({
    strike,
    days,
    ann_yield: annualYield,
    delta,
    iv,
    bid_usd: 1,
  });
  const input = { minDays: 7, maxDays: 45, targetOtm: 10 };
  const payload = {
    asset: "PDD",
    asset_class: "us_equity",
    spot_price: 100,
    decision_blocked: true,
    stale: false,
    expiries: {
      "2026-09-18": { puts: [row(95, 21, 10, -0.2), row(85, 21, 30, -0.4)] },
      "2026-10-02": { puts: [row(90, 35, 40, -0.1)] },
    },
  };
  const summary = aggregate(payload, input);
  assert.equal(settingsValid(input), true);
  assert.equal(summary.status, "indicative");
  assert.equal(summary.symbol, "PDD");
  assert.equal(summary.expiryCount, 2);
  assert.equal(summary.annualYield, 30);
  assert.equal(summary.absDelta, 0.2);
});

test("U.S. stock requests use the owner session and persist custom assets", () => {
  for (const token of [
    'const STORAGE_KEY = "mango.fixed-otm.assets.v1"',
    'const OWNER_SESSION_KEY = "mango.owner.session.v1"',
    'const API_BASE = "https://yvpgdnbcjgxpjqenhvuo.supabase.co/functions/v1/options-api"',
    "/api/us-stocks/options?ticker=",
    "Authorization: `Bearer ${session.accessToken}`",
    "storage.setItem(STORAGE_KEY, JSON.stringify(assets))",
    'link.href = `/us-options/?ticker=${encodeURIComponent(summary.symbol)}`',
    "研究可比 · 非 OPRA",
  ]) {
    assert.ok(source.includes(token), `missing production behavior: ${token}`);
  }
  assert.equal(source.includes("innerHTML"), false);
});
