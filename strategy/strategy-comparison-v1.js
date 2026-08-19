"use strict";

(() => {
  const ASSETS = Object.freeze(["BTC", "ETH", "HYPE"]);
  const API_BASE = "https://yvpgdnbcjgxpjqenhvuo.supabase.co/functions/v1/options-api";
  const $ = (id) => document.getElementById(id);
  let payloads = new Map();
  let controller = null;
  let requestVersion = 0;

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
    const expiries = payload?.expiries || payload?.exchanges?.Deribit?.expiries || {};
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
    const symbol = String(payload?.asset || payload?.symbol || "").toUpperCase();
    const spot = number(payload?.spot_price);
    if (!ASSETS.includes(symbol) || spot === null || spot <= 0) return { symbol, status: "error" };
    if (payload?.decision_blocked || payload?.stale || number(payload?.quote_age_seconds) > 120) {
      return { symbol, spot, status: "blocked" };
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
      status: expiries.length ? "ready" : "empty",
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

  function render() {
    const input = settings();
    const state = $("compareState");
    const wrap = $("compareTableWrap");
    const body = $("compareRows");
    if (!settingsValid(input)) {
      state.hidden = false;
      state.className = "compare-state error";
      state.textContent = "比较条件无效：DTE 最低值不能高于最高值，目标 OTM 必须在 0% 到 100% 之间。";
      wrap.hidden = true;
      return;
    }
    const summaries = ASSETS.map((symbol) => {
      const payload = payloads.get(symbol);
      return payload?.loadError ? { symbol, status: "error" } : payload ? aggregate(payload, input) : { symbol, status: "loading" };
    }).sort((a, b) => (b.annualYield ?? -1) - (a.annualYield ?? -1));
    const ready = summaries.filter((summary) => summary.status === "ready").length;
    $("compareCount").textContent = `${ready}/3 个资产可比`;
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
      cell(row, summary.status === "ready" ? `${summary.expiryCount} 个到期日 · ${summary.quoteCount} 个相邻报价` : "—");
      cell(row, percent(summary.targetOtm));
      cell(row, percent(summary.annualYield));
      cell(row, summary.absDelta === null || summary.absDelta === undefined ? "—" : summary.absDelta.toFixed(2));
      cell(row, percent(summary.iv));
      const labels = { ready: "可比", blocked: "报价过期", empty: "目标 OTM 无相邻报价", error: "加载失败", loading: "加载中" };
      cell(row, labels[summary.status] || "不可用", summary.status);
      const linkCell = document.createElement("td");
      const link = document.createElement("a");
      link.href = `/options/?asset=${encodeURIComponent(summary.symbol)}`;
      link.textContent = "查看该资产 Strike";
      linkCell.append(link);
      row.append(linkCell);
      body.append(row);
    });
    state.hidden = true;
    state.className = "compare-state";
    wrap.hidden = false;
  }

  async function load() {
    const version = ++requestVersion;
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    $("compareState").hidden = false;
    $("compareState").className = "compare-state";
    $("compareState").textContent = "正在加载三个资产的期权链…";
    $("compareTableWrap").hidden = true;
    const results = await Promise.all(ASSETS.map(async (symbol) => {
      try {
        const response = await fetch(`${API_BASE}/api/options?asset=${encodeURIComponent(symbol)}`, { cache: "no-store", signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
        return [symbol, payload];
      } catch (error) {
        if (error?.name === "AbortError") return null;
        return [symbol, { asset: symbol, loadError: true }];
      }
    }));
    if (signal.aborted || version !== requestVersion) return;
    payloads = new Map(results.filter(Boolean));
    render();
  }

  $("compareApply")?.addEventListener("click", render);
  $("compareReload")?.addEventListener("click", load);
  ["compareMinDays", "compareMaxDays", "compareTargetOtm"].forEach((id) => {
    $(id)?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") render();
    });
  });
  load();
})();
