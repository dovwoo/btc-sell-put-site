(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DecisionRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const QUOTE_TTL_MS = 120000;
  const finite = value => value === null || value === undefined || value === "" || typeof value === "boolean"
    ? null : Number.isFinite(Number(value)) ? Number(value) : null;

  function timestamp(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value) return null;
    const normalized = value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(:\d{2})? UTC$/, "$1T$2$3Z");
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function trustedPercentile(history, key = "days_365", days = 365) {
    const value = finite(history?.percentiles?.[key]);
    const samples = finite(history?.percentile_sample_counts?.[key]);
    const coverage = finite(history?.percentile_coverage_days?.[key]);
    const age = finite(history?.percentile_latest_age_days?.[key]);
    if (value === null || value < 0 || value > 100 || samples === null || coverage === null || age === null) return null;
    if (samples < Math.max(20, Math.ceil(days * .6)) || coverage < days * .8 || age < 0 || age > (history?.market === "us_stock" ? 4 : 3)) return null;
    return value;
  }

  // This is the sole classification policy used by both the market page and desk.
  // A passing market gate permits contract research, never a trade recommendation.
  function classifySellPut({ blocked = false, coreComplete = false, position = null, vrp = null, direction = null } = {}) {
    if (blocked || !coreComplete || finite(vrp) === null || !position || !direction) return "unknown";
    if (vrp <= 0) return "no";
    return position.code === "high" && direction.tone === "good" ? "screen" : "wait";
  }

  function quoteFresh(payload, receivedAt, now = Date.now(), maxAgeMs = QUOTE_TTL_MS) {
    if (!payload || payload.stale || payload.decision_blocked || payload.blocked) return false;
    const age = finite(payload.source_age_seconds ?? payload.quote_age_seconds);
    const quoteAge = finite(payload.quote_age_seconds);
    const received = finite(receivedAt);
    if (age === null || age < 0 || received === null || now < received - 30000) return false;
    return Math.max(age, quoteAge ?? 0) * 1000 + Math.max(0, now - received) <= maxAgeMs;
  }

  function marketAssessment({ chain, timing, history, receivedAt }, now = Date.now()) {
    const metrics = timing?.metrics || {};
    const dvol = finite(metrics.dvol), rv = finite(metrics.rv), vrp = finite(metrics.vrp);
    const percentile = trustedPercentile(history);
    const change4h = finite(metrics.dvol_change_4h);
    const change1d = finite(metrics.dvol_change_1d ?? history?.change_1d_pct);
    const position = percentile === null ? null : { code: percentile >= 75 ? "high" : percentile <= 25 ? "low" : "middle" };
    const direction = change4h === null || change1d === null ? null : { tone: change4h < 0 && change1d < 0 ? "good" : "warn" };
    const identitiesMatch = chain?.asset === "BTC" && timing?.asset === "BTC" && history?.symbol === "BTC";
    const timingAt = timestamp(timing?.updated);
    const blocked = !identitiesMatch || !quoteFresh(chain, receivedAt, now) || timing?.blocked || timing?.action_code === "stale"
      || timingAt === null || timingAt > now + 30000 || now - timingAt > 600000;
    const coreComplete = [dvol, rv, vrp, percentile, change4h, change1d].every(v => v !== null);
    const state = classifySellPut({ blocked, coreComplete, position, vrp, direction });
    const labels = { unknown: "等待 · 证据不足", no: "等待 · 市场溢价未通过", wait: "等待 · 市场条件未齐", screen: "可以进入合约复核" };
    const reasons = {
      unknown: "行情过期、来源不一致或核心数据缺失；刷新后再判断。",
      no: "DVOL 没有高于 30D RV；当前未见正的市场级波动率溢价。",
      wait: "市场级溢价、高位 IV 和 4 小时 / 1 日降温条件尚未同时满足。",
      screen: "市场条件通过；具体报价、成本、资金和尾部风险仍须逐项复核。",
    };
    return { state, label: labels[state], reason: reasons[state], dvol, rv, vrp, percentile, change4h, change1d, blocked: Boolean(blocked), asOf: timingAt };
  }

  function putRows(chain, now = Date.now()) {
    const groups = chain?.expiries || chain?.exchanges?.Deribit?.expiries || {};
    return Object.entries(groups).flatMap(([expiry, group]) => (group?.puts || []).map(raw => {
      const expiryAt = timestamp(raw.expiry_timestamp) ?? timestamp(`${raw.expiry || expiry}T08:00:00Z`);
      return { ...raw, expiry: raw.expiry || expiry, expiryAt, days: expiryAt === null ? null : (expiryAt - now) / 86400000 };
    })).filter(row => /^BTC_USDC-\d{1,2}[A-Z]{3}\d{2}-\d+(?:\.\d+)?-P$/.test(row.instrument || "")
      && finite(row.strike) > 0 && finite(row.bid_usd) > 0 && row.days > 0);
  }

  function accountCapacity(account, positions) {
    if (!account || !Array.isArray(positions)) return null;
    const cash = finite(account.stablecoin_usd), floor = finite(account.cash_floor_usd);
    if (cash === null || cash < 0 || floor === null || floor < 0) return null;
    let committed = 0;
    for (const row of positions) {
      const strike = finite(row.strike), quantity = finite(row.notional_btc);
      if (!['BTC', 'ETH', 'HYPE'].includes(row.asset) || (row.kind && row.kind !== 'sell_put') || strike === null || quantity === null || strike <= 0 || quantity <= 0) return null;
      committed += strike * quantity; // Includes expired positions until settlement is confirmed.
    }
    return { cash, floor, committed, available: Math.max(0, cash - floor - committed), deficit: Math.max(0, committed + floor - cash) };
  }

  function contractReview({ row, chain, depth, depthReceivedAt, quantity, feesUsd, slippageUsd, opportunityApy, maxStrike, capacity, market, receivedAt }, now = Date.now()) {
    const blockers = [];
    const q = finite(quantity), fees = finite(feesUsd), slippage = finite(slippageUsd), apy = finite(opportunityApy);
    const strike = finite(row?.strike), spot = finite(chain?.spot_price);
    const cap = finite(maxStrike);
    const minimum = finite(chain?.min_trade_amount);
    const validQuantity = q !== null && minimum > 0 && q >= minimum && Math.abs(q / minimum - Math.round(q / minimum)) < 1e-7;
    const expiryAt = timestamp(row?.expiry_timestamp) ?? timestamp(`${row?.expiry}T08:00:00Z`);
    const days = expiryAt === null ? null : (expiryAt - now) / 86400000;
    if (!validQuantity) blockers.push("数量须符合真实合约的最小交易单位。");
    if (fees === null || fees < 0 || slippage === null || slippage < 0 || apy === null || apy < 0 || apy > 100) blockers.push("填写本笔费用、滑点预算和资金机会成本。");
    if (!strike || !spot || strike >= spot || cap === null || strike > cap || !days || days <= 0) blockers.push("合约须未到期、价外且不超过你接受的行权价。");
    if (chain?.asset !== "BTC" || chain?.provider_family !== "BTC_USDC" || chain?.settlement_currency !== "USDC") blockers.push("当前流程只复核 BTC_USDC 线性现金结算 Put。");
    if (!quoteFresh(chain, receivedAt, now)) blockers.push("期权链已过期，请刷新。");
    // source_age includes the 120s instrument-universe cache. The observed book
    // has its own 30s quote age; do not confuse directory age with a stale Bid.
    const observedAge = finite(depth?.quote_age_seconds);
    const depthValid = depth?.asset === "BTC" && depth?.instrument === row?.instrument && depth?.depth_unit === "BTC"
      && quoteFresh(depth, depthReceivedAt, now) && observedAge !== null && observedAge >= 0
      && observedAge * 1000 + Math.max(0, now - depthReceivedAt) <= 30000;
    const bid = depthValid ? finite(depth.best_bid_price) : null;
    const ask = depthValid ? finite(depth.best_ask_price) : null;
    const bidSize = depthValid ? finite(depth.bid_size) : null;
    if (!depthValid || bid === null || bid <= 0 || ask === null || ask < bid || bidSize === null || bidSize < q) blockers.push("需要更新的双边盘口，且顶档 Bid 数量须覆盖计划数量。");
    const spreadPct = bid > 0 && ask >= bid ? (ask - bid) / ((bid + ask) / 2) * 100 : null;
    if (spreadPct !== null && spreadPct > 15) blockers.push("买卖价差超过 15%，需等待流动性改善。");
    if (market?.state !== "screen") blockers.push(market?.reason || "市场条件尚未通过。");
    const capitalUsd = validQuantity && strike ? strike * q : null;
    if (!capacity) blockers.push("先连接账户并核对稳定币余额、现金保留额和已有义务。");
    else if (capitalUsd > capacity.available) blockers.push("本笔完整行权金额超过扣除已有义务后的可用资金。");
    const gross = validQuantity && bid > 0 ? bid * q : null;
    const net = gross !== null && fees !== null && slippage !== null ? gross - fees - slippage : null;
    const opportunityCost = capitalUsd !== null && days > 0 && apy !== null ? capitalUsd * apy / 100 * days / 365 : null;
    if (net !== null && opportunityCost !== null && net <= opportunityCost) blockers.push("扣除费用和滑点的条件收入未覆盖资金机会成本。");
    return { blockers, ready: blockers.length === 0, bid, ask, bidSize, spreadPct, gross, net, capitalUsd, opportunityCost, days,
      breakEven: net !== null && q > 0 ? strike - net / q : null,
      maximumLoss: capitalUsd !== null && net !== null ? capitalUsd - net : null,
      down30Pnl: net !== null && q > 0 && spot > 0 ? net - Math.max(0, strike - spot * .7) * q : null };
  }

  return { finite, timestamp, trustedPercentile, classifySellPut, quoteFresh, marketAssessment, putRows, accountCapacity, contractReview };
});
