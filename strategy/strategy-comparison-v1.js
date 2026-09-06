"use strict";

(() => {
  const DEFAULT_ASSETS = Object.freeze(["BTC", "ETH", "HYPE"]);
  const MAX_ASSETS = 8;
  const STORAGE_KEY = "mango.fixed-otm.assets.v1";
  const OWNER_SESSION_KEY = "mango.owner.session.v1";
  const API_BASE = String(window.MANGO_API_BASE || "https://yvpgdnbcjgxpjqenhvuo.supabase.co/functions/v1/options-api").replace(/\/$/, "");
  const BASE_PATH = window.MANGO_BASE_PATH || "/";
  const receivedTimes = new Map();
  const $ = (id) => document.getElementById(id);
  let assets = readAssets();
  let payloads = new Map();
  const controllers = new Map();
  const requestVersions = new Map();

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeTicker(value) {
    const symbol = String(value || "").trim().toUpperCase();
    return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : "";
  }

  function readAssets(storage = window.localStorage) {
    try {
      const stored = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      const custom = Array.isArray(stored)
        ? stored.map(normalizeTicker).filter((symbol) => symbol && !DEFAULT_ASSETS.includes(symbol))
        : [];
      return [...DEFAULT_ASSETS, ...new Set(custom)].slice(0, MAX_ASSETS);
    } catch {
      return [...DEFAULT_ASSETS];
    }
  }

  function saveAssets(storage = window.localStorage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(assets));
      return true;
    } catch {
      return false;
    }
  }

  function average(values) {
    const valid = values.map(number).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function settings() {
    return {
      minDays: number($("compareMinDays").value),
      maxDays: number($("compareMaxDays").value),
      targetOtm: number($("compareTargetOtm").value),
    };
  }

  function settingsValid(value = settings()) {
    return value.minDays !== null
      && value.maxDays !== null
      && value.targetOtm !== null
      && value.minDays >= 0
      && value.maxDays >= value.minDays
      && value.targetOtm >= 0
      && value.targetOtm < 100;
  }

  function rows(payload) {
    const result = [];
    const expiries = payload?.expiries || payload?.exchanges?.Deribit?.expiries || payload?.exchanges?.Alpaca?.expiries || {};
    Object.entries(expiries).forEach(([expiry, group]) => {
      (group?.puts || []).forEach((row) => result.push({ ...row, expiry: row.expiry || expiry }));
    });
    return result;
  }

  function otm(row, spot) {
    const strike = number(row?.strike);
    if (strike === null || spot === null || spot <= 0 || strike <= 0 || strike >= spot) return null;
    return (spot - strike) / spot * 100;
  }

  function interpolateValue(lower, upper, key, weight) {
    const low = number(lower?.[key]);
    const high = number(upper?.[key]);
    return low === null || high === null ? null : low + (high - low) * weight;
  }

  function interpolateExpiry(expiryRows, targetOtm) {
    const grouped = new Map();
    expiryRows.forEach((row) => {
      if (row.otm === null || row.annualYield === null || row.bid === null || row.bid <= 0) return;
      const key = row.otm.toFixed(8);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    const points = [...grouped.values()].map((matches) => ({
      otm: average(matches.map((row) => row.otm)),
      annualYield: average(matches.map((row) => row.annualYield)),
      absDelta: average(matches.map((row) => row.absDelta)),
      iv: average(matches.map((row) => row.iv)),
      quoteCount: matches.length,
    })).sort((a, b) => a.otm - b.otm);
    const exact = points.find((point) => Math.abs(point.otm - targetOtm) < 1e-8);
    if (exact) return { ...exact, targetOtm };
    const lower = [...points].reverse().find((point) => point.otm < targetOtm);
    const upper = points.find((point) => point.otm > targetOtm);
    if (!lower || !upper || upper.otm <= lower.otm) return null;
    const weight = (targetOtm - lower.otm) / (upper.otm - lower.otm);
    return {
      targetOtm,
      annualYield: interpolateValue(lower, upper, "annualYield", weight),
      absDelta: interpolateValue(lower, upper, "absDelta", weight),
      iv: interpolateValue(lower, upper, "iv", weight),
      quoteCount: lower.quoteCount + upper.quoteCount,
    };
  }

  function aggregate(payload, input = settings()) {
    const symbol = normalizeTicker(payload?.asset || payload?.symbol);
    const spot = number(payload?.spot_price);
    const isUsStock = payload?.asset_class === "us_equity";
    if (!symbol || spot === null || spot <= 0) return { symbol, status: "error" };
    if (payload?.stale || (!isUsStock && (payload?.decision_blocked || number(payload?.quote_age_seconds) > 120))) {
      return { symbol, spot, isUsStock, status: "blocked" };
    }
    const eligible = rows(payload).map((row) => {
      const delta = number(row.delta);
      return {
        ...row,
        days: number(row.days),
        otm: otm(row, spot),
        annualYield: number(row.ann_yield),
        absDelta: delta === null ? null : Math.abs(delta),
        iv: number(row.iv),
        bid: number(row.bid_usd),
      };
    }).filter((row) => row.days !== null
      && row.days >= input.minDays
      && row.days <= input.maxDays
      && row.otm !== null
      && row.annualYield !== null
      && row.annualYield >= 0
      && row.bid !== null
      && row.bid > 0);
    const byExpiry = new Map();
    eligible.forEach((row) => {
      if (!byExpiry.has(row.expiry)) byExpiry.set(row.expiry, []);
      byExpiry.get(row.expiry).push(row);
    });
    const expiries = [...byExpiry.values()]
      .map((expiryRows) => interpolateExpiry(expiryRows, input.targetOtm))
      .filter(Boolean);
    return {
      symbol,
      spot,
      isUsStock,
      status: expiries.length ? (isUsStock ? "indicative" : "ready") : "empty",
      expiryCount: expiries.length,
      quoteCount: expiries.reduce((sum, row) => sum + row.quoteCount, 0),
      targetOtm: input.targetOtm,
      annualYield: average(expiries.map((row) => row.annualYield)),
      absDelta: average(expiries.map((row) => row.absDelta)),
      iv: average(expiries.map((row) => row.iv)),
    };
  }

  function percent(value, digits = 1) {
    const parsed = number(value);
    return parsed === null ? "—" : `${parsed.toFixed(digits)}%`;
  }

  function cell(row, text, className = "") {
    const item = document.createElement("td");
    item.textContent = text;
    if (className) item.className = className;
    row.append(item);
  }

  function ownerSession(storage = window.localStorage) {
    const config = window.MANGO_OWNER_CONFIG || {};
    try {
      const session = JSON.parse(storage.getItem(OWNER_SESSION_KEY) || "null");
      if (!config.anonKey || !session?.access_token || number(session.expires_at) * 1000 <= Date.now()) return null;
      return { anonKey: config.anonKey, accessToken: session.access_token };
    } catch {
      return null;
    }
  }

  function requestFor(symbol, signal) {
    if (DEFAULT_ASSETS.includes(symbol)) {
      return {
        url: `${API_BASE}/api/options?asset=${encodeURIComponent(symbol)}`,
        init: { cache: "no-store", signal },
      };
    }
    const session = ownerSession();
    if (!session) return null;
    return {
      url: `${API_BASE}/api/us-stocks/options?ticker=${encodeURIComponent(symbol)}`,
      init: {
        cache: "no-store",
        signal,
        headers: { apikey: session.anonKey, Authorization: `Bearer ${session.accessToken}` },
      },
    };
  }

  function renderAssetManager() {
    const chips = $("compareAssetChips");
    chips.replaceChildren();
    assets.forEach((symbol) => {
      const chip = document.createElement("span");
      chip.className = "compare-asset-chip";
      const name = document.createElement("b");
      name.textContent = symbol;
      chip.append(name);
      if (DEFAULT_ASSETS.includes(symbol)) {
        const lock = document.createElement("span");
        lock.className = "compare-asset-lock";
        lock.textContent = "默认";
        chip.append(lock);
      } else {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.removeAsset = symbol;
        remove.setAttribute("aria-label", `从比较中移除 ${symbol}`);
        remove.textContent = "×";
        chip.append(remove);
      }
      chips.append(chip);
    });
    $("compareAssetCount").textContent = `${assets.length} / ${MAX_ASSETS}`;
    const submit = $("compareAssetForm").querySelector('button[type="submit"]');
    submit.disabled = assets.length >= MAX_ASSETS;
  }

  function render() {
    const input = settings();
    const state = $("compareState");
    const wrap = $("compareTableWrap");
    const body = $("compareRows");
    renderAssetManager();
    if (!settingsValid(input)) {
      state.hidden = false;
      state.className = "compare-state error";
      state.textContent = "比较条件无效：DTE 最低值不能高于最高值，目标 OTM 必须在 0% 到 100% 之间。";
      wrap.hidden = true;
      return;
    }
    const summaries = assets.map((symbol) => {
      let payload = payloads.get(symbol);
      if (payload && DEFAULT_ASSETS.includes(symbol) && window.DecisionRules && receivedTimes.has(symbol)
        && !window.DecisionRules.quoteFresh(payload, receivedTimes.get(symbol))) {
        payload = { ...payload, decision_blocked: true };
      }
      if (payload?.authRequired) return { symbol, status: "auth" };
      return payload?.loadError ? { symbol, status: "error" } : payload ? aggregate(payload, input) : { symbol, status: "loading" };
    }).sort((a, b) => (b.annualYield ?? -1) - (a.annualYield ?? -1));
    const ready = summaries.filter((summary) => ["ready", "indicative"].includes(summary.status)).length;
    $("compareCount").textContent = `${ready}/${assets.length} 个资产可比`;
    body.replaceChildren();
    summaries.forEach((summary) => {
      const row = document.createElement("tr");
      const assetCell = document.createElement("td");
      const assetName = document.createElement("strong");
      const spot = document.createElement("small");
      assetName.textContent = summary.symbol;
      spot.textContent = summary.spot ? `Spot $${summary.spot.toLocaleString("en-US", { maximumFractionDigits: summary.spot >= 100 ? 0 : 2 })}` : "—";
      assetCell.append(assetName, spot);
      row.append(assetCell);
      cell(row, ["ready", "indicative"].includes(summary.status) ? `${summary.expiryCount} 个到期日 · ${summary.quoteCount} 个相邻报价` : "—");
      cell(row, percent(summary.targetOtm));
      cell(row, percent(summary.annualYield));
      cell(row, summary.absDelta === null || summary.absDelta === undefined ? "—" : summary.absDelta.toFixed(2));
      cell(row, percent(summary.iv));
      const labels = { ready: "可比", indicative: "研究可比 · 非 OPRA", blocked: "报价过期", empty: "目标 OTM 无相邻报价", error: "加载失败", auth: "需登录", loading: "加载中" };
      cell(row, labels[summary.status] || "不可用", summary.status);
      const linkCell = document.createElement("td");
      const link = document.createElement("a");
      if (summary.status === "auth") {
        link.href = `${BASE_PATH}owner/`;
        link.textContent = "登录后加载";
      } else if (!DEFAULT_ASSETS.includes(summary.symbol)) {
        link.href = `${BASE_PATH}us-options/?ticker=${encodeURIComponent(summary.symbol)}`;
        link.textContent = "查看该美股 Strike";
      } else {
        link.href = `${BASE_PATH}options/?asset=${encodeURIComponent(summary.symbol)}`;
        link.textContent = "查看该资产 Strike";
      }
      linkCell.append(link);
      row.append(linkCell);
      body.append(row);
    });
    state.hidden = true;
    state.className = "compare-state";
    wrap.hidden = false;
  }

  function commitPayload(symbol, payload, receivedAt) {
    const at = number(receivedAt);
    const currentAt = receivedTimes.get(symbol);
    if (at !== null && currentAt !== undefined && at < currentAt) return false;
    payloads.set(symbol, payload);
    if (at === null) receivedTimes.delete(symbol);
    else receivedTimes.set(symbol, at);
    return true;
  }

  async function load(symbols = assets, { reset = false } = {}) {
    if (reset) {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      payloads = new Map();
    }
    symbols.forEach((symbol) => payloads.delete(symbol));
    $("compareState").hidden = false;
    $("compareState").className = "compare-state";
    $("compareState").textContent = `正在加载 ${symbols.length} 个资产的期权链…`;
    render();
    const results = await Promise.all(symbols.map(async (symbol) => {
      controllers.get(symbol)?.abort();
      const controller = new AbortController();
      const { signal } = controller;
      const version = (requestVersions.get(symbol) || 0) + 1;
      controllers.set(symbol, controller);
      requestVersions.set(symbol, version);
      const request = requestFor(symbol, signal);
      if (!request) return [symbol, { asset: symbol, authRequired: true }, version, signal];
      try {
        if (DEFAULT_ASSETS.includes(symbol) && window.MangoMarketSource?.getChain) {
          const shared = await window.MangoMarketSource.getChain(symbol, { refresh: reset });
          return [symbol, shared.payload, version, signal, shared.receivedAt];
        }
        const response = await fetch(request.url, request.init);
        const payload = await response.json();
        if ([401, 403].includes(response.status)) {
          return [symbol, { asset: symbol, authRequired: true }, version, signal];
        }
        if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
        return [symbol, payload, version, signal, Date.now()];
      } catch (error) {
        if (error?.name === "AbortError") return null;
        return [symbol, { asset: symbol, loadError: true }, version, signal];
      }
    }));
    results.filter(Boolean).forEach(([symbol, payload, version, signal, receivedAt]) => {
      if (signal?.aborted || (version && requestVersions.get(symbol) !== version)) return;
      commitPayload(symbol, payload, receivedAt);
    });
    render();
  }

  function feedback(message, kind = "") {
    const node = $("compareAssetFeedback");
    node.textContent = message;
    node.className = kind;
  }

  window.addEventListener("mango:chain", (event) => {
    const { asset, payload, receivedAt } = event.detail || {};
    if (!DEFAULT_ASSETS.includes(asset) || !assets.includes(asset) || payload?.asset !== asset) return;
    if (!commitPayload(asset, payload, receivedAt)) return;
    // A shared refresh supersedes pending batches, including older failures.
    requestVersions.set(asset, (requestVersions.get(asset) || 0) + 1);
    render();
  });
  setInterval(() => render(), 5000);

  $("compareAssetForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("compareTickerInput");
    const symbol = normalizeTicker(input.value);
    if (!symbol) {
      feedback("Ticker 格式不对：请输入 1–10 位英文字母或常见 Ticker 符号。", "error");
      return;
    }
    if (assets.includes(symbol)) {
      feedback(`${symbol} 已经在比较中。`, "error");
      return;
    }
    if (assets.length >= MAX_ASSETS) {
      feedback(`最多同时比较 ${MAX_ASSETS} 个资产。`, "error");
      return;
    }
    assets.push(symbol);
    saveAssets();
    input.value = "";
    feedback(`已添加 ${symbol}，正在加载期权链。`, "success");
    renderAssetManager();
    load([symbol]);
  });

  $("compareAssetChips")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-asset]");
    if (!button) return;
    const symbol = normalizeTicker(button.dataset.removeAsset);
    if (!symbol || DEFAULT_ASSETS.includes(symbol)) return;
    controllers.get(symbol)?.abort();
    controllers.delete(symbol);
    assets = assets.filter((asset) => asset !== symbol);
    payloads.delete(symbol);
    saveAssets();
    feedback(`已从比较中移除 ${symbol}。`, "success");
    render();
  });

  $("compareApply")?.addEventListener("click", render);
  $("compareReload")?.addEventListener("click", () => load(assets, { reset: true }));
  ["compareMinDays", "compareMaxDays", "compareTargetOtm"].forEach((id) => {
    $(id)?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") render();
    });
  });

  window.MANGO_FIXED_OTM_TESTING = Object.freeze({
    DEFAULT_ASSETS,
    MAX_ASSETS,
    STORAGE_KEY,
    normalizeTicker,
    settingsValid,
    aggregate,
  });

  renderAssetManager();
  load(assets);
})();
