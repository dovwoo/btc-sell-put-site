"use strict";

const SNAPSHOT_DATE = "2026-08-12";

const TERMS = Object.freeze({
  short: { days: 21, label: "2–4 周" },
  recommended: { days: 45, label: "1–2 个月" },
  long: { days: 75, label: "2–3 个月" },
});

const SIZE_PERCENT = Object.freeze({ trial: 10, standard: 25, none: 0 });

const ASSETS = Object.freeze({
  BTC: {
    name: "Bitcoin",
    spot: 64806,
    unit: "BTC",
    step: 0.01,
    mandate: { direction: "add", label: "继续积累" },
    settlement: { venue: "Deribit", type: "cash_difference", currency: "BTC", physicalDelivery: false },
    spotHolding: 0.35,
    coreHolding: 0.2,
    targetHolding: [1, 2],
    targetPrice: [100000, 130000],
    maxExposure: 2,
    putPoolCash: 20000,
    putPoolQuantity: 0.3,
    callPoolQuantity: 0.15,
    reviewDate: "2028-02-10",
    market: {
      asOf: "2026-08-12 10:30 UTC",
      confidence: "中等",
      overall: "good",
      label: "更值得看 · 可以小批",
      headline: "增持参考价、持仓空间和流动性同时通过；当前仍只适合分批。",
      sell_put: {
        status: "good",
        label: "较好",
        reason: "4h 跌势放缓，VRP 仍为正，主力期限流动性通过。",
        recheck: "若 4h 再度转弱、VRP 转负或主力期限流动性不再通过，撤回建议。",
      },
      covered_call: {
        status: "watch",
        label: "一般",
        reason: "价格尚未进入理想减仓区，只允许极小覆盖。",
        recheck: "价格接近长期减仓区且 IV 仍处中高位时重新比较。",
      },
      iv: "90 日中高位",
      vrp: "+7.2 vol",
      trend: "4h 跌势放缓",
      liquidity: "主力期限良好",
      dataFresh: true,
      liquidityOk: true,
    },
    candidates: {
      sell_put: [
        { id: "btc-put-main", role: "系统推荐", strike: 60000, premium: 1440, probability: 77, delta: -0.23, note: "增持参考价和权利金最平衡。" },
        { id: "btc-put-safe", role: "增持参考价更低", strike: 58000, premium: 1000, probability: 84, delta: -0.16, note: "少收一些权利金，换取更低的增持参考价。" },
        { id: "btc-put-income", role: "权利金更多", strike: 62000, premium: 2060, probability: 68, delta: -0.32, note: "收入更高，但更容易进入亏损区。" },
      ],
      covered_call: [
        { id: "btc-call-main", role: "系统推荐", strike: 85000, premium: 800, probability: 78, delta: 0.21, note: "卖出价与权利金较平衡。" },
        { id: "btc-call-safe", role: "保留更多上涨", strike: 90000, premium: 520, probability: 86, delta: 0.14, note: "权利金较少，但上涨空间保留更多。" },
        { id: "btc-call-income", role: "权利金更多", strike: 80000, premium: 1200, probability: 69, delta: 0.31, note: "收入更高，但更早放弃上涨空间。" },
      ],
    },
  },
  ETH: {
    name: "Ethereum",
    spot: 3420,
    unit: "ETH",
    step: 0.1,
    mandate: { direction: "add", label: "继续积累" },
    settlement: { venue: "Deribit", type: "cash_difference", currency: "ETH", physicalDelivery: false },
    spotHolding: 4,
    coreHolding: 3,
    targetHolding: [10, 20],
    targetPrice: [5500, 8000],
    maxExposure: 20,
    putPoolCash: 12000,
    putPoolQuantity: 3,
    callPoolQuantity: 1,
    reviewDate: "2028-02-10",
    market: {
      asOf: "2026-08-12 10:30 UTC",
      confidence: "中等",
      overall: "watch",
      label: "一般 · 只适合试单",
      headline: "权利金尚可，但日线仍弱；标准仓位暂时不通过。",
      sell_put: {
        status: "watch",
        label: "一般",
        reason: "权利金仍有补偿，但日线偏弱，只允许最小试单。",
        recheck: "ETH 日线转稳且 VRP 仍为正时重新比较。",
      },
      covered_call: {
        status: "wait",
        label: "等待",
        reason: "现价离长期减仓区仍远，当前权利金不足以补偿上涨封顶。",
        recheck: "价格进入长期减仓区，且 Call 权利金补偿改善后重新比较。",
      },
      iv: "90 日高位",
      vrp: "+5.1 vol",
      trend: "1d 仍偏弱",
      liquidity: "近月尚可",
      dataFresh: true,
      liquidityOk: true,
    },
    candidates: {
      sell_put: [
        { id: "eth-put-main", role: "系统推荐", strike: 3100, premium: 105, probability: 75, delta: -0.24, note: "当前只适合用最小仓位观察。" },
        { id: "eth-put-safe", role: "增持参考价更低", strike: 2900, premium: 62, probability: 84, delta: -0.15, note: "安全垫更大，但权利金明显减少。" },
        { id: "eth-put-income", role: "权利金更多", strike: 3300, premium: 152, probability: 66, delta: -0.34, note: "收入更高，但当前趋势下接近现价。" },
      ],
      covered_call: [
        { id: "eth-call-main", role: "系统推荐", strike: 4800, premium: 58, probability: 80, delta: 0.2, note: "在较高卖出价和收入之间平衡。" },
        { id: "eth-call-safe", role: "保留更多上涨", strike: 5200, premium: 39, probability: 87, delta: 0.13, note: "保留更多上涨空间。" },
        { id: "eth-call-income", role: "权利金更多", strike: 4400, premium: 82, probability: 71, delta: 0.29, note: "收入更高，但较早封顶上涨。" },
      ],
    },
  },
});

const DEMO_POSITIONS = Object.freeze([
  { id: "btc-put-1", asset: "BTC", kind: "sell_put", strike: 60000, expiry: "2026-09-25", quantity: 0.1, linkedSpotAction: "add" },
  { id: "btc-put-2", asset: "BTC", kind: "sell_put", strike: 58000, expiry: "2026-10-30", quantity: 0.05, linkedSpotAction: "add" },
  { id: "btc-call-1", asset: "BTC", kind: "covered_call", strike: 85000, expiry: "2026-09-25", quantity: 0.1, linkedSpotAction: "reduce", coveredBySpot: true },
  { id: "eth-put-1", asset: "ETH", kind: "sell_put", strike: 3000, expiry: "2026-09-25", quantity: 1, linkedSpotAction: "add" },
  { id: "old-btc-put", asset: "BTC", kind: "sell_put", strike: 50000, expiry: "2026-07-31", quantity: 0.5, linkedSpotAction: "add" },
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundDown(value, step) {
  return Math.floor((value + 1e-9) / step) * step;
}

function money(value, maximumFractionDigits = 0) {
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits })}`;
}

function quantity(value, assetKey) {
  const digits = assetKey === "BTC" ? 3 : 2;
  return Number(Number(value).toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function activePosition(row, asOf = SNAPSHOT_DATE) {
  return String(row.expiry || "") >= asOf;
}

function positionsFor(assetKey, rows = DEMO_POSITIONS) {
  return rows.filter((row) => row.asset === assetKey && activePosition(row));
}

function portfolioFor(assetKey, rows = DEMO_POSITIONS) {
  const asset = ASSETS[assetKey];
  const positions = positionsFor(assetKey, rows);
  const puts = positions.filter((row) => row.kind === "sell_put");
  const calls = positions.filter((row) => ["covered_call", "sell_call"].includes(row.kind));
  const linkedAdds = puts.filter((row) => row.linkedSpotAction === "add");
  const linkedReductions = calls.filter((row) => row.linkedSpotAction === "reduce" && row.coveredBySpot === true);
  const coveredCalls = calls.filter((row) => row.coveredBySpot === true);
  const putQuantity = puts.reduce((sum, row) => sum + row.quantity, 0);
  const callQuantity = calls.reduce((sum, row) => sum + row.quantity, 0);
  const linkedAddQuantity = linkedAdds.reduce((sum, row) => sum + row.quantity, 0);
  const linkedReductionQuantity = linkedReductions.reduce((sum, row) => sum + row.quantity, 0);
  const coveredCallQuantity = coveredCalls.reduce((sum, row) => sum + row.quantity, 0);
  const putBudgetUsed = puts.reduce((sum, row) => sum + row.strike * row.quantity, 0);
  const plannedSpotLow = Math.max(0, asset.spotHolding - linkedReductionQuantity);
  const plannedSpotHigh = asset.spotHolding + linkedAddQuantity;
  const authorizedCallRemaining = Math.max(0, Math.min(
    asset.callPoolQuantity - coveredCallQuantity,
    asset.spotHolding - asset.coreHolding - coveredCallQuantity,
  ));
  return {
    positions,
    puts,
    calls,
    linkedAdds,
    linkedReductions,
    putQuantity,
    callQuantity,
    linkedAddQuantity,
    linkedReductionQuantity,
    coveredCallQuantity,
    putBudgetUsed,
    plannedSpotLow,
    plannedSpotHigh,
    authorizedCallRemaining,
  };
}

function strategyForDirection(direction) {
  if (direction === "add") return "sell_put";
  if (direction === "reduce") return "covered_call";
  return "wait";
}

function directionGoalLabel(direction) {
  return ({ add: "想多持有", hold: "保持现状", reduce: "想少持有" })[direction] || "尚未选择";
}

function effectiveDirection(direction, acceptance) {
  if (direction !== "hold") return direction;
  if (acceptance === "add_small") return "add";
  if (acceptance === "reduce_small") return "reduce";
  return "hold";
}

function primaryCandidateFor(assetKey, strategy) {
  return ASSETS[assetKey].candidates[strategy]?.[0] || null;
}

function acceptanceReferenceFor(assetKey, direction, termKey = "recommended") {
  const strategy = strategyForDirection(direction);
  if (strategy === "wait") return null;
  const asset = ASSETS[assetKey];
  const primary = primaryCandidateFor(assetKey, strategy);
  const term = TERMS[termKey] || TERMS.recommended;
  const scale = Math.sqrt(term.days / TERMS.recommended.days);
  const premium = primary.premium * scale;
  const capacity = tradeCapacity(assetKey, strategy, "trial", primary.strike);
  return {
    strategy,
    strike: primary.strike,
    dte: term.days,
    quantity: capacity.quantity,
    budget: strategy === "sell_put" ? primary.strike * capacity.quantity : 0,
    referencePrice: strategy === "sell_put" ? primary.strike - premium : primary.strike + premium,
    settlementCurrency: asset.settlement.currency,
  };
}

function q2Config(direction, assetKey, termKey = "recommended") {
  const reference = acceptanceReferenceFor(assetKey, direction, termKey);
  if (direction === "add") {
    return {
      title: `如果到期结算价低于 ${money(reference.strike)}，你仍愿意另外买入吗？`,
      note: `短 Put 会产生差额结算亏损，不会交付 ${assetKey}。按当前权利金折算，增持盈亏平衡参考价约 ${money(reference.referencePrice)}/${assetKey}；若长期判断不变，计划另行买入 ${quantity(reference.quantity, assetKey)} ${assetKey}，预留预算约 ${money(reference.budget)}。实际现货成交价以届时市场为准。`,
      choices: [
        { value: "full", label: "愿意按这个条件增持", description: "系统可在剩余额度内给方案" },
        { value: "small", label: "只愿意少量增持", description: "系统只给最小试单" },
        { value: "none", label: "不愿意增持", description: "今天不卖 Put" },
      ],
    };
  }
  if (direction === "reduce") {
    return {
      title: `如果到期结算价高于 ${money(reference.strike)}，你能接受上涨被部分抵消吗？`,
      note: `短 Call 会产生差额结算亏损，经济上抵消相应现货上涨，但不会自动卖出 ${assetKey}。按当前权利金折算，有效封顶参考价约 ${money(reference.referencePrice)}/${assetKey}；若仍要减仓，计划另行卖出 ${quantity(reference.quantity, assetKey)} ${assetKey}。`,
      choices: [
        { value: "full", label: "愿意按这个条件减仓", description: "只关联可卖的非核心现货" },
        { value: "small", label: "只愿意少量减仓", description: "系统只给最小试单" },
        { value: "none", label: "不愿意减仓", description: "今天不卖 Covered Call" },
      ],
    };
  }
  if (direction === "hold") {
    const addReference = acceptanceReferenceFor(assetKey, "add", termKey);
    const reduceReference = acceptanceReferenceFor(assetKey, "reduce", termKey);
    return {
      title: "仓位基本合适时，你最多接受哪种小变化？",
      note: `选择即代表你接受对应的经济后果。${ASSETS[assetKey].settlement.venue} 以 ${ASSETS[assetKey].settlement.currency} 差额结算，现货不会自动增减。`,
      choices: [
        { value: "none", label: "完全保持不变（默认）", description: "不接受任何方向的仓位变化，今天等待" },
        { value: "add_small", label: "跌下来多买一点", description: `${money(addReference.strike)} Put · 最多 ${quantity(addReference.quantity, assetKey)} ${assetKey} · 参考价约 ${money(addReference.referencePrice)}；低于 Strike 会结算差额亏损` },
        { value: "reduce_small", label: "涨上去减一点", description: `${money(reduceReference.strike)} Call · 最多 ${quantity(reduceReference.quantity, assetKey)} ${assetKey} · 封顶参考价约 ${money(reduceReference.referencePrice)}；高于 Strike 的上涨会被部分抵消` },
      ],
    };
  }
  return { title: "先回答上一题", note: "", choices: [] };
}

function strategyFromAnswers(direction, acceptance) {
  if (!direction) return null;
  if (direction === "hold" && !acceptance) return "wait";
  if (!acceptance) return null;
  if (acceptance === "none") return "wait";
  if (direction === "add") return "sell_put";
  if (direction === "reduce") return "covered_call";
  if (direction === "hold" && acceptance === "add_small") return "sell_put";
  if (direction === "hold" && acceptance === "reduce_small") return "covered_call";
  return "wait";
}

function acceptanceCapsTrial(direction, acceptance) {
  return acceptance === "small" || (direction === "hold" && acceptance !== "none");
}

function expiryFromDte(days) {
  const date = new Date(`${SNAPSHOT_DATE}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const distanceToFriday = (5 - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + (distanceToFriday > 3 ? distanceToFriday - 7 : distanceToFriday));
  return date.toISOString().slice(0, 10);
}

function daysToExpiry(expiry) {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${SNAPSHOT_DATE}T00:00:00Z`)) / 86400000);
}

function timingFor(assetKey, strategy) {
  if (!strategy || strategy === "wait") return { status: "wait", label: "等待" };
  return ASSETS[assetKey].market[strategy];
}

const STATUS_PRIORITY = Object.freeze({ good: 4, watch: 3, wait: 2, blocked: 1 });

function opportunityFor(assetKey, direction) {
  const asset = ASSETS[assetKey];
  const strategy = strategyForDirection(direction);
  if (strategy === "wait") {
    return {
      assetKey,
      strategy,
      status: "wait",
      label: "保持现状",
      reason: "你的目标是保持仓位，因此不主动寻找卖方合约。",
      recheck: "只有你主动愿意接受小幅增持或减仓时，才重新开启比较。",
    };
  }
  if (!asset.market.dataFresh) {
    return { assetKey, strategy, status: "blocked", label: "数据过期", reason: "行情快照已过期。", recheck: "刷新行情后重新比较。" };
  }
  if (!asset.market.liquidityOk) {
    return { assetKey, strategy, status: "blocked", label: "流动性不足", reason: "当前没有流动性合格的合约。", recheck: "主力期限流动性恢复后重新比较。" };
  }
  const timing = timingFor(assetKey, strategy);
  if (timing.status === "wait") {
    return { assetKey, strategy, status: "wait", label: "等待", reason: timing.reason, recheck: timing.recheck };
  }
  const primary = primaryCandidateFor(assetKey, strategy);
  const capacity = tradeCapacity(assetKey, strategy, "trial", primary.strike);
  if (capacity.blocked) {
    return {
      assetKey,
      strategy,
      status: "blocked",
      label: "额度已满",
      reason: capacity.reason,
      recheck: strategy === "sell_put" ? "现有 Put 到期或平仓释放增持预算后重新检查。" : "现有 Call 到期或平仓释放非核心现货后重新检查。",
    };
  }
  return { assetKey, strategy, status: timing.status, label: timing.label, reason: timing.reason, recheck: timing.recheck, capacity };
}

function rankOpportunities(direction) {
  return Object.keys(ASSETS)
    .map((assetKey) => opportunityFor(assetKey, direction))
    .sort((a, b) => (STATUS_PRIORITY[b.status] || 0) - (STATUS_PRIORITY[a.status] || 0));
}

function effectiveSize(assetKey, answers) {
  const strategy = strategyFromAnswers(answers.direction, answers.acceptance);
  const timing = timingFor(assetKey, strategy);
  if (!strategy || strategy === "wait" || answers.size === "none") return "none";
  if (answers.size === "standard" && (acceptanceCapsTrial(answers.direction, answers.acceptance) || timing.status === "watch")) return "trial";
  return answers.size;
}

function tradeCapacity(assetKey, strategy, sizeKey, primaryStrike) {
  const asset = ASSETS[assetKey];
  const portfolio = portfolioFor(assetKey);
  const percent = SIZE_PERCENT[sizeKey] || 0;
  if (strategy === "sell_put") {
    const requestedQuantity = asset.putPoolQuantity * percent / 100;
    const requestedBudget = asset.putPoolCash * percent / 100;
    const remainingQuantity = Math.max(0, asset.putPoolQuantity - portfolio.putQuantity);
    const remainingBudget = Math.max(0, asset.putPoolCash - portfolio.putBudgetUsed);
    const cashLimit = Math.min(requestedBudget, remainingBudget) / primaryStrike;
    const exposureLimit = Math.max(0, asset.maxExposure - portfolio.plannedSpotHigh);
    const rawQuantity = Math.min(requestedQuantity, remainingQuantity, cashLimit, exposureLimit);
    const tradeQuantity = roundDown(rawQuantity, asset.step);
    const limitingConstraint = rawQuantity === requestedQuantity
      ? (tradeQuantity < rawQuantity ? "minimum_step" : "requested_size")
      : rawQuantity === remainingBudget / primaryStrike || rawQuantity === cashLimit
        ? "cash_remaining"
        : rawQuantity === remainingQuantity
          ? "quantity_remaining"
          : "maximum_exposure";
    return {
      percent,
      quantity: tradeQuantity,
      cash: primaryStrike * tradeQuantity,
      requestedBudget,
      remainingBudget,
      remainingQuantity,
      limitingConstraint,
      portfolio,
      blocked: tradeQuantity < asset.step,
      reason: tradeQuantity < asset.step ? "现有 Put 已占用现金预算、数量额度或最大计划持仓，剩余不足最小试单。" : "",
    };
  }
  if (strategy === "covered_call") {
    const requestedQuantity = asset.callPoolQuantity * percent / 100;
    const rawQuantity = Math.min(requestedQuantity, portfolio.authorizedCallRemaining);
    const tradeQuantity = roundDown(rawQuantity, asset.step);
    return {
      percent,
      quantity: tradeQuantity,
      cash: 0,
      requestedQuantity,
      remainingQuantity: portfolio.authorizedCallRemaining,
      limitingConstraint: tradeQuantity < rawQuantity ? "minimum_step" : rawQuantity < requestedQuantity ? "uncovered_spot_remaining" : "requested_size",
      portfolio,
      blocked: tradeQuantity < asset.step,
      reason: tradeQuantity < asset.step ? "没有可关联的新非核心现货；现有 Call 已占用全部策略授权。" : "",
    };
  }
  return { percent: 0, quantity: 0, cash: 0, portfolio, blocked: true, reason: "当前没有可执行策略。" };
}

function deploymentProgressFor(assetKey, strategy, sizeKey, primaryStrike, tradeQuantityOverride = null) {
  const asset = ASSETS[assetKey];
  const capacity = tradeCapacity(assetKey, strategy, sizeKey, primaryStrike);
  if (strategy === "sell_put") {
    const total = asset.putPoolCash;
    const deployed = Math.min(total, capacity.portfolio.putBudgetUsed);
    const plannedCash = primaryStrike * (tradeQuantityOverride ?? capacity.quantity);
    const trade = Math.min(Math.max(0, total - deployed), plannedCash);
    const remaining = Math.max(0, total - deployed - trade);
    return {
      strategy,
      unit: "cash",
      total,
      deployed,
      trade,
      remaining,
      deployedPercent: total ? deployed / total * 100 : 0,
      tradePercent: total ? trade / total * 100 : 0,
      remainingPercent: total ? remaining / total * 100 : 0,
      capacity,
    };
  }
  const total = Math.min(asset.callPoolQuantity, Math.max(0, asset.spotHolding - asset.coreHolding));
  const deployed = Math.min(total, capacity.portfolio.coveredCallQuantity);
  const trade = Math.min(Math.max(0, total - deployed), tradeQuantityOverride ?? capacity.quantity);
  const remaining = Math.max(0, total - deployed - trade);
  return {
    strategy,
    unit: "quantity",
    total,
    deployed,
    trade,
    remaining,
    deployedPercent: total ? deployed / total * 100 : 0,
    tradePercent: total ? trade / total * 100 : 0,
    remainingPercent: total ? remaining / total * 100 : 0,
    capacity,
  };
}

function recommendationFor(assetKey, answers) {
  const asset = ASSETS[assetKey];
  if (!answers.direction) return { status: "incomplete", step: 1 };
  if (answers.direction === "hold" && (!answers.acceptance || answers.acceptance === "none")) {
    return {
      status: "wait",
      source: "hold_default",
      strategy: "wait",
      requestedStrategy: "wait",
      reason: "你选择保持当前仓位；系统不会为了收权利金把你推向一笔不需要的交易。",
      recheck: "只有你主动愿意接受极小增持或减仓时，才重新开启合约比较。",
    };
  }
  if (!answers.acceptance) return { status: "incomplete", step: 2 };

  const strategy = strategyFromAnswers(answers.direction, answers.acceptance);
  if (strategy === "wait") {
    const requestedStrategy = strategyForDirection(answers.direction);
    return {
      status: "wait",
      source: "preference",
      strategy,
      requestedStrategy,
      reason: "你的真实意愿与卖方策略不一致；权利金再高也不生成合约。",
      recheck: "只有增持或减仓意愿改变时才重新开启；行情改善不会绕过这项选择。",
    };
  }

  const timing = timingFor(assetKey, strategy);
  if (!asset.market.dataFresh) return { status: "blocked", source: "data", strategy, reason: "行情快照已经过期，刷新后再判断。", recheck: "刷新行情快照后重新检查。" };
  if (!asset.market.liquidityOk) return { status: "blocked", source: "liquidity", strategy, reason: "没有找到流动性合格的合约。", recheck: "主力期限流动性恢复后重新检查。" };
  if (timing.status === "wait") return { status: "wait", source: "timing", strategy, reason: timing.reason, recheck: timing.recheck };
  const primary = asset.candidates[strategy][0];
  const trialCapacity = tradeCapacity(assetKey, strategy, "trial", primary.strike);
  if (trialCapacity.blocked) return {
    status: "blocked",
    source: "capacity",
    strategy,
    reason: trialCapacity.reason,
    recheck: strategy === "sell_put" ? "现有 Put 到期或平仓释放增持预算后重新检查。" : "现有 Call 到期或平仓释放非核心现货后重新检查。",
    capacity: trialCapacity,
  };
  if (!answers.size) return { status: "incomplete", step: 3, strategy };
  if (answers.size === "none") return { status: "wait", source: "size", strategy, reason: "你选择保留本次额度，因此不生成合约。", recheck: "当你愿意动用本次机动额度时重新选择。" };

  const selectedSize = effectiveSize(assetKey, answers);
  const capacity = tradeCapacity(assetKey, strategy, selectedSize, primary.strike);
  if (capacity.blocked) return {
    status: "blocked",
    source: "capacity",
    strategy,
    reason: capacity.reason,
    recheck: strategy === "sell_put" ? "现有 Put 到期或平仓释放增持预算后重新检查。" : "现有 Call 到期或平仓释放非核心现货后重新检查。",
    capacity,
  };

  const override = answers.size !== selectedSize
    ? `你选择了标准 25%，但${timing.status === "watch" ? "当前机会只到“一般”" : "你只愿意成交一小部分"}；系统建议降为试单 10%。`
    : "";
  return {
    status: timing.status === "watch" ? "watch" : "good",
    strategy,
    size: selectedSize,
    capacity,
    timing,
    recheck: timing.recheck,
    override,
  };
}

function candidatesFor(assetKey, recommendation, termKey = "recommended") {
  if (!["good", "watch"].includes(recommendation.status)) return [];
  const asset = ASSETS[assetKey];
  const term = TERMS[termKey] || TERMS.recommended;
  const scale = Math.sqrt(term.days / TERMS.recommended.days);
  const tradeQuantity = recommendation.capacity.quantity;
  const expiry = expiryFromDte(term.days);
  return asset.candidates[recommendation.strategy].map((base) => {
    const premium = base.premium * scale;
    const common = {
      ...base,
      expiry,
      dte: daysToExpiry(expiry),
      quantity: tradeQuantity,
      premium,
      premiumTotal: premium * tradeQuantity,
      conditionalAnnualized: premium / (recommendation.strategy === "sell_put" ? base.strike : asset.spot) * 365 / daysToExpiry(expiry) * 100,
    };
    if (recommendation.strategy === "sell_put") {
      return {
        ...common,
        netPrice: base.strike - premium,
        cash: base.strike * tradeQuantity,
        plannedSpotAfter: recommendation.capacity.portfolio.plannedSpotHigh + tradeQuantity,
      };
    }
    return {
      ...common,
      effectiveSale: base.strike + premium,
      plannedSpotAfter: Math.max(0, recommendation.capacity.portfolio.plannedSpotLow - tradeQuantity),
    };
  }).filter((candidate) => {
    if (recommendation.strategy !== "sell_put") return true;
    const budgetCap = Math.min(recommendation.capacity.requestedBudget, recommendation.capacity.remainingBudget);
    return candidate.cash <= budgetCap + 1e-9;
  }).slice(0, 3);
}

function freshState() {
  return { direction: null, acceptance: null, size: null, term: "recommended", selectedCandidate: null };
}

function applyChoiceToState(current, group, value) {
  const field = group === "direction" ? "direction" : group === "acceptance" ? "acceptance" : group === "size" ? "size" : null;
  if (!field || current[field] === value) return false;
  if (group === "direction") {
    current.direction = value;
    current.acceptance = value === "hold" ? "none" : null;
    current.size = value === "hold" ? "none" : null;
  } else if (group === "acceptance") {
    current.acceptance = value;
    current.size = value === "none" ? "none" : null;
  } else {
    current.size = value;
  }
  current.selectedCandidate = null;
  return true;
}

function directionLabel(value) {
  return directionGoalLabel(value) || "尚未选择";
}

function acceptanceLabel(direction, value, assetKey = "BTC", termKey = "recommended") {
  const config = q2Config(direction, assetKey, termKey);
  return config.choices.find((choice) => choice.value === value)?.label || "尚未选择";
}

function sizeLabel(value) {
  return ({ trial: "先试一笔", standard: "使用标准仓位", none: "今天不用" })[value] || "尚未选择";
}

function stateClass(status) {
  return status === "good" ? "" : status;
}

function statusLabel(status) {
  return ({ good: "适合", watch: "一般", wait: "等待", blocked: "阻止", incomplete: "待选择" })[status] || "等待";
}

function routeNameForRecommendation(recommendation) {
  const route = recommendation.requestedStrategy || recommendation.strategy;
  return route === "covered_call" ? "Covered Call" : route === "sell_put" ? "Sell Put" : "交易";
}

function settlementText(strategy, assetKey, candidate) {
  const qty = quantity(candidate.quantity, assetKey);
  const currency = ASSETS[assetKey].settlement.currency;
  if (strategy === "sell_put") {
    return `若到期结算价低于 ${money(candidate.strike)}，短 Put 会以 ${currency} 差额结算亏损，不会交付 ${assetKey}；若长期判断不变，仍需另行买入 ${qty} ${assetKey}。`;
  }
  return `若到期结算价高于 ${money(candidate.strike)}，短 Call 会以 ${currency} 差额结算亏损，经济上抵消相应现货上涨，但不会自动卖出现货；若仍要减仓，需另行卖出 ${qty} ${assetKey}。`;
}

function obligationDetails(strategy, assetKey, candidate) {
  const qty = quantity(candidate.quantity, assetKey);
  const currency = ASSETS[assetKey].settlement.currency;
  if (strategy === "sell_put") {
    return [
      ["期权结果", `低于 ${money(candidate.strike)} 时以 ${currency} 差额结算亏损，不会收到 ${assetKey}`],
      ["现货动作", `长期判断不变时，另行买入 ${qty} ${assetKey}`],
      ["本次上限", `增持计划预算 ${money(candidate.cash)}，盈亏平衡参考价 ${money(candidate.netPrice)}`],
    ];
  }
  return [
    ["期权结果", `高于 ${money(candidate.strike)} 时以 ${currency} 差额结算亏损，现货不会自动卖出`],
    ["现货动作", `仍要减仓时，另行卖出 ${qty} ${assetKey}`],
    ["本次上限", `关联 ${qty} ${assetKey} 非核心现货，有效封顶参考价 ${money(candidate.effectiveSale)}`],
  ];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initBrowserPrototype() {
  const uiStates = { BTC: freshState(), ETH: freshState() };
  let assetKey = "BTC";
  let comparisonGoal = ASSETS.BTC.mandate.direction;
  const $ = (id) => document.getElementById(id);

  function state() {
    return uiStates[assetKey];
  }

  function choiceButton(group, choice, selected, disabled = false) {
    return `<button type="button" class="choice${selected ? " selected" : ""}" data-choice-group="${group}" data-value="${choice.value}" aria-pressed="${selected}"${disabled ? " disabled" : ""}><strong>${escapeHtml(choice.label)}</strong><small>${escapeHtml(choice.description)}</small></button>`;
  }

  function renderProfile() {
    const asset = ASSETS[assetKey];
    $("profileDetails").innerHTML = `<dl><dt>长期方向</dt><dd>${asset.mandate.label}</dd><dt>目标持仓</dt><dd>${quantity(asset.targetHolding[0], assetKey)}–${quantity(asset.targetHolding[1], assetKey)} ${assetKey}</dd><dt>核心仓位</dt><dd>${quantity(asset.coreHolding, assetKey)} ${assetKey}</dd><dt>复核日期</dt><dd>${asset.reviewDate}</dd></dl>`;
  }

  function comparisonDirection() {
    return comparisonGoal;
  }

  function strategyName(strategy) {
    return strategy === "covered_call" ? "Covered Call" : strategy === "sell_put" ? "Sell Put" : "等待";
  }

  function comparisonSummary(direction, ranked) {
    if (direction === "hold") return "按这次“保持现状”的目标，BTC 和 ETH 都不主动寻找卖方合约。";
    const best = ranked[0];
    const other = ranked[1];
    return `按这次“${directionGoalLabel(direction)}”的目标，${best.assetKey} 的 ${strategyName(best.strategy)} 条件更完整；${other.assetKey} 当前为“${other.label}”。`;
  }

  function renderMarketScan() {
    const direction = comparisonDirection();
    const ranked = rankOpportunities(direction);
    const byAsset = Object.fromEntries(ranked.map((item) => [item.assetKey, item]));
    $("opportunityTitle").textContent = `按“${directionGoalLabel(direction)}”目标比较 BTC 和 ETH`;
    $("marketScanSummary").textContent = comparisonSummary(direction, ranked);
    $("assetComparison").innerHTML = Object.entries(ASSETS).map(([key, asset]) => {
      const portfolio = portfolioFor(key);
      const opportunity = byAsset[key];
      const selected = key === assetKey;
      return `<button type="button" class="asset-row${selected ? " selected" : ""}" role="tab" aria-selected="${selected}" data-asset="${key}"><span class="asset-symbol"><strong>${key}</strong><span>${money(asset.spot)}</span></span><span class="asset-signal"><span class="asset-signal-head"><b class="signal-label ${opportunity.status}">${opportunity.label}</b><span>${selected ? "正在研究" : `查看 ${key}`}</span></span><p>${opportunity.reason}</p><span class="signal-line"><span>本次比较 <b>${strategyName(opportunity.strategy)}</b></span><span>判断信心 <b>${asset.market.confidence}</b></span></span><span class="signal-line"><span>当前现货 <b>${quantity(asset.spotHolding, key)} ${key}</b></span><span>计划后区间 <b>${quantity(portfolio.plannedSpotLow, key)}–${quantity(portfolio.plannedSpotHigh, key)}</b></span></span><span class="signal-time">数据 ${asset.market.asOf} · 计划后区间仅在另行执行现货动作后成立</span></span></button>`;
    }).join("");
  }

  function renderDirection() {
    const choices = [
      { value: "add", label: "多一点", description: "愿意在更低价格继续买" },
      { value: "hold", label: "差不多", description: "只接受很小的仓位变化" },
      { value: "reduce", label: "少一点", description: "涨到合适价格愿意减仓" },
    ];
    $("directionChoices").innerHTML = choices.map((choice) => choiceButton("direction", choice, state().direction === choice.value)).join("");
  }

  function renderAcceptance() {
    const config = q2Config(state().direction, assetKey, state().term);
    $("questionTwoTitle").textContent = config.title;
    $("acceptanceChoices").innerHTML = config.choices.length
      ? config.choices.map((choice) => choiceButton("acceptance", choice, state().acceptance === choice.value)).join("") + `<p class="step-note settlement-question-note">${escapeHtml(config.note)}</p>`
      : `<p class="locked-copy">先回答第 1 题。</p>`;
  }

  function sizePreview(sizeKey, strategy) {
    const asset = ASSETS[assetKey];
    const percent = SIZE_PERCENT[sizeKey];
    if (sizeKey === "none") return "保留额度，不生成合约";
    if (!strategy || strategy === "wait") return `${percent}% 机动仓位`;
    const primary = asset.candidates[strategy][0];
    const capacity = tradeCapacity(assetKey, strategy, sizeKey, primary.strike);
    if (strategy === "sell_put") return `计划 ${quantity(capacity.quantity, assetKey)} ${assetKey} · 预留约 ${money(capacity.cash)}（总机动池 ${percent}%）`;
    return `关联 ${quantity(capacity.quantity, assetKey)} ${assetKey} 非核心现货（总机动池 ${percent}%）`;
  }

  function renderSize() {
    const current = state();
    const strategy = strategyFromAnswers(current.direction, current.acceptance);
    const timing = timingFor(assetKey, strategy);
    const primary = strategy && strategy !== "wait" ? primaryCandidateFor(assetKey, strategy) : null;
    const trialCapacity = primary ? tradeCapacity(assetKey, strategy, "trial", primary.strike) : null;
    const locked = !current.acceptance || strategy === "wait" || timing.status === "wait" || trialCapacity?.blocked;
    const capsTrial = acceptanceCapsTrial(current.direction, current.acceptance) || timing.status === "watch";
    const choices = [
      { value: "trial", label: "小批", description: sizePreview("trial", strategy) },
      { value: "standard", label: "标准", description: sizePreview("standard", strategy) },
      { value: "none", label: "今天不用", description: "保留额度，不生成合约" },
    ];
    $("sizeChoices").innerHTML = choices.map((choice) => choiceButton(
      "size",
      choice,
      current.size === choice.value,
      locked || (choice.value === "standard" && capsTrial),
    )).join("");

    if (!current.acceptance) $("sizeStepNote").textContent = "先回答第 2 题。";
    else if (strategy === "wait") $("sizeStepNote").textContent = "你的回答已经指向等待，不需要再选择仓位。";
    else if (timing.status === "wait") $("sizeStepNote").textContent = `${assetKey} 当前这条策略路线未通过，系统不会要求你选择仓位。`;
    else if (trialCapacity?.blocked) $("sizeStepNote").textContent = "当前机动额度已用满，本次不再询问仓位。";
    else if (capsTrial) $("sizeStepNote").textContent = "当前只建议试单；标准 25% 暂时不可选。";
    else $("sizeStepNote").textContent = "10% / 25% 均按总授权机动池计算，并会先扣除现有 Put 或 Call。";
  }

  function renderQuestionStates() {
    document.querySelector('[data-step="1"]').classList.toggle("answered", Boolean(state().direction));
    document.querySelector('[data-step="2"]').classList.toggle("answered", Boolean(state().acceptance));
    document.querySelector('[data-step="3"]').classList.toggle("answered", Boolean(state().size));
  }

  function renderTerms() {
    const current = state();
    const term = TERMS[current.term];
    $("termSummary").textContent = `约 ${term.days} 天`;
    $("termChoices").innerHTML = Object.entries(TERMS).map(([key, value]) => `<button type="button" class="term-option${current.term === key ? " selected" : ""}" data-term="${key}" aria-pressed="${current.term === key}">${value.label}<br>${value.days} 天</button>`).join("");
  }

  function answerSummary() {
    const current = state();
    const sizeAnswer = current.size ? sizeLabel(current.size) : "系统已跳过仓位题";
    return `<div class="answer-summary"><span>你的选择</span><button type="button" data-edit-step="1">${directionLabel(current.direction)} ${assetKey}</button><button type="button" data-edit-step="2">${acceptanceLabel(current.direction, current.acceptance, assetKey, current.term)}</button><button type="button" data-edit-step="3">${sizeAnswer}</button></div>`;
  }

  function accountContext() {
    const asset = ASSETS[assetKey];
    const portfolio = portfolioFor(assetKey);
    return `<div class="account-context"><div><span>现货（结算不自动改变）</span><strong>${quantity(asset.spotHolding, assetKey)} ${assetKey}</strong></div><div><span>已卖 Put / Call 名义数量</span><strong>${quantity(portfolio.putQuantity, assetKey)} / ${quantity(portfolio.callQuantity, assetKey)}</strong></div><div><span>若另行执行现货计划</span><strong>${quantity(portfolio.plannedSpotLow, assetKey)}–${quantity(portfolio.plannedSpotHigh, assetKey)} ${assetKey}</strong></div></div>`;
  }

  function positionsHtml() {
    const portfolio = portfolioFor(assetKey);
    const rows = [
      `<div class="position-row"><div><span>资产</span><strong>${assetKey} 现货</strong></div><div><span>数量</span><strong>${quantity(ASSETS[assetKey].spotHolding, assetKey)} ${assetKey}</strong></div><div><span>作用</span><strong>当前持有</strong></div></div>`,
      ...portfolio.positions.map((row) => {
        const action = row.linkedSpotAction === "add"
          ? `另行增持 ${quantity(row.quantity, assetKey)} ${assetKey}`
          : row.linkedSpotAction === "reduce" && row.coveredBySpot === true
            ? `另行减仓 ${quantity(row.quantity, assetKey)} ${assetKey}`
            : "仅期权名义风险，无现货计划";
        return `<div class="position-row"><div><span>合约</span><strong>${assetKey} ${money(row.strike)} ${row.kind === "sell_put" ? "Put" : "Call"}</strong></div><div><span>到期 / 名义数量</span><strong>${row.expiry} · ${quantity(row.quantity, assetKey)}</strong></div><div><span>关联现货计划</span><strong>${action}</strong></div></div>`;
      }),
    ];
    return `<details class="position-details"><summary>查看自动匹配的持仓明细</summary><div class="position-list">${rows.join("")}</div></details>`;
  }

  function reasoningHtml(recommendation, primary) {
    const asset = ASSETS[assetKey];
    const market = asset.market;
    return `<details class="reasoning"><summary>为什么是现在？查看专业数据</summary><div class="reasoning-grid"><div class="reason"><span>IV 位置</span><strong>${market.iv}</strong></div><div class="reason"><span>VRP</span><strong>${market.vrp}</strong></div><div class="reason"><span>价格路径</span><strong>${market.trend}</strong></div><div class="reason"><span>流动性</span><strong>${market.liquidity}</strong></div><div class="reason"><span>主合约 Delta</span><strong>${primary ? primary.delta.toFixed(2) : "—"}</strong></div><div class="reason"><span>结算方式</span><strong>${asset.settlement.venue} 以 ${asset.settlement.currency} 差额结算，不交割现货</strong></div></div></details>`;
  }

  function comparisonExplanation(direction) {
    if (direction === "hold") {
      return `<div class="comparison-explanation"><span>为什么不选资产</span><p>你选择保持现状，因此不需要在 BTC 和 ETH 之间强行找一笔交易。</p></div>`;
    }
    const ranked = rankOpportunities(direction);
    const chosen = ranked.find((item) => item.assetKey === assetKey);
    const other = ranked.find((item) => item.assetKey !== assetKey);
    const lead = ranked[0].assetKey === assetKey ? `为什么先看 ${assetKey}` : `你正在查看 ${assetKey}`;
    return `<div class="comparison-explanation"><span>${lead}</span><p>同一 ${strategyName(chosen.strategy)} 目标下，${assetKey}：${chosen.reason} ${other.assetKey}：${other.reason}</p></div>`;
  }

  function progressValue(value, unit) {
    return unit === "cash" ? money(value) : `${quantity(value, assetKey)} ${assetKey}`;
  }

  function selectedOrPrimary(candidates) {
    return candidates.find((candidate) => candidate.id === state().selectedCandidate) || candidates[0];
  }

  function trancheProgressHtml(recommendation, candidates) {
    const activeCandidate = selectedOrPrimary(candidates);
    const progress = deploymentProgressFor(assetKey, recommendation.strategy, recommendation.size, activeCandidate.strike, activeCandidate.quantity);
    const title = recommendation.strategy === "sell_put"
      ? `${assetKey} Sell Put 增持机动预算（已包含现有短 Put）`
      : `${assetKey} Covered Call 非核心现货授权（已包含现有短 Call）`;
    const displayDeployed = Math.round(progress.deployedPercent);
    const displayTrade = Math.round(progress.tradePercent);
    const displayRemaining = Math.max(0, 100 - displayDeployed - displayTrade);
    return `<section class="tranche-progress" aria-label="分批额度进度"><div class="tranche-progress-head"><div><span>分批计划</span><strong>${title}</strong></div><b>总授权 ${progressValue(progress.total, progress.unit)}</b></div><div class="tranche-bar" role="img" aria-label="已有 ${displayDeployed}%，本次 ${displayTrade}%，剩余 ${displayRemaining}%"><i class="deployed" style="width:${clamp(progress.deployedPercent, 0, 100)}%"></i><i class="current" style="width:${clamp(progress.tradePercent, 0, 100)}%"></i><i class="remaining" style="width:${clamp(progress.remainingPercent, 0, 100)}%"></i></div><div class="tranche-legend"><div><span>已有义务</span><strong>${progressValue(progress.deployed, progress.unit)}</strong><small>${displayDeployed}%</small></div><div><span>本次计划</span><strong>${progressValue(progress.trade, progress.unit)}</strong><small>${displayTrade}%</small></div><div><span>交易后剩余</span><strong>${progressValue(progress.remaining, progress.unit)}</strong><small>${displayRemaining}%</small></div></div></section>`;
  }

  function recheckHtml(recommendation) {
    const copy = recommendation.recheck || timingFor(assetKey, recommendation.strategy).recheck || "行情或持仓发生变化后重新检查。";
    return `<div class="recheck"><span>什么会改变这个结论</span><p>${escapeHtml(copy)}</p></div>`;
  }

  function obligationHtml(strategy, candidate) {
    return `<div class="obligation"><span>判断错误时会发生什么</span><div class="obligation-rows">${obligationDetails(strategy, assetKey, candidate).map(([label, copy]) => `<div><b>${label}</b><p>${copy}</p></div>`).join("")}</div></div>`;
  }

  function candidateMetrics(strategy, candidate) {
    if (strategy === "sell_put") {
      return `<div class="metrics"><div class="metric"><span>权利金 / 条件年化</span><strong>${money(candidate.premiumTotal, 0)} · ${candidate.conditionalAnnualized.toFixed(1)}%</strong></div><div class="metric"><span>增持盈亏平衡参考价</span><strong>${money(candidate.netPrice)}</strong></div><div class="metric"><span>到期不进价内</span><strong>${candidate.probability}% <small>估算</small></strong></div><div class="metric"><span>增持计划预算</span><strong>${money(candidate.cash)}</strong></div></div>`;
    }
    return `<div class="metrics"><div class="metric"><span>权利金 / 条件年化</span><strong>${money(candidate.premiumTotal, 0)} · ${candidate.conditionalAnnualized.toFixed(1)}%</strong></div><div class="metric"><span>有效封顶参考价</span><strong>${money(candidate.effectiveSale)}</strong></div><div class="metric"><span>到期不进价内</span><strong>${candidate.probability}% <small>估算</small></strong></div><div class="metric"><span>策略关联现货</span><strong>${quantity(candidate.quantity, assetKey)} ${assetKey}</strong></div></div>`;
  }

  function primaryCandidateHtml(strategy, candidate, selected) {
    const title = `${assetKey} ${money(candidate.strike)} ${strategy === "sell_put" ? "Put" : "Call"}`;
    return `<article class="candidate-primary${selected ? " selected-contract" : ""}"><p class="candidate-kicker">${candidate.role}</p><h3>${title}</h3><p class="candidate-summary">${candidate.expiry} 到期 · ${candidate.dte} 天 · ${quantity(candidate.quantity, assetKey)} ${assetKey}</p>${obligationHtml(strategy, candidate)}${candidateMetrics(strategy, candidate)}<div class="candidate-action"><p>${candidate.note}</p><button type="button" data-select-candidate="${candidate.id}">${selected ? "已选择" : "选择这张"}</button></div></article>`;
  }

  function altCandidateHtml(strategy, candidate, selected) {
    const mainValue = strategy === "sell_put" ? money(candidate.netPrice) : money(candidate.effectiveSale);
    const reference = acceptanceReferenceFor(assetKey, state().direction === "hold" ? (strategy === "sell_put" ? "add" : "reduce") : state().direction, state().term);
    const asksMore = strategy === "sell_put" ? candidate.netPrice > reference.referencePrice : candidate.effectiveSale < reference.referencePrice;
    const action = asksMore ? (strategy === "sell_put" ? "接受更高参考价并选择" : "接受更低封顶并选择") : "选择";
    return `<article class="candidate-alt${selected ? " selected-contract" : ""}"><p>${candidate.role}</p><h4>${assetKey} ${money(candidate.strike)} ${strategy === "sell_put" ? "Put" : "Call"}</h4><div class="alt-stats"><span>权利金 / 条件年化<b>${money(candidate.premiumTotal, 0)} · ${candidate.conditionalAnnualized.toFixed(1)}%</b></span><span>${strategy === "sell_put" ? "盈亏平衡参考价" : "有效封顶参考价"}<b>${mainValue}</b></span><span>到期不进价内<b>${candidate.probability}% · 估算</b></span><span>数量<b>${quantity(candidate.quantity, assetKey)} ${assetKey}</b></span></div><p class="alt-note">${candidate.note}</p><button type="button" data-select-candidate="${candidate.id}">${selected ? "已选择" : action}</button></article>`;
  }

  function selectedBanner(candidates) {
    const selected = candidates.find((candidate) => candidate.id === state().selectedCandidate);
    if (!selected) return "";
    return `<div class="selected-banner"><span>已选合约</span><strong>${assetKey} ${money(selected.strike)} · ${selected.expiry}</strong><p>${settlementText(strategyFromAnswers(state().direction, state().acceptance), assetKey, selected)}</p><b>原型到此，不会发送订单。</b></div>`;
  }

  function incompleteHtml(recommendation) {
    const portfolio = portfolioFor(assetKey);
    const asset = ASSETS[assetKey];
    const copy = recommendation.step === 1
      ? "先告诉系统你想增加、保持还是减少仓位。"
      : recommendation.step === 2
        ? "再确认你是否真的接受到价后的经济后果。"
        : "最后选择试单、标准仓位或今天不做。";
    return `<div class="result-lead"><div class="result-state wait">${recommendation.step}/3</div><div class="result-copy"><span class="section-index">LIVE RESULT</span><h2 id="recommendationTitle">答案会在这里出现</h2><p>${copy}</p></div></div>${accountContext()}<div class="wait-panel"><h3>系统已经准备好的上下文</h3><p>你不需要重新输入持仓、现金、期限或 Strike。</p><div class="wait-conditions"><div class="wait-condition"><i>✓</i><span>当前现货 ${quantity(asset.spotHolding, assetKey)} ${assetKey}</span></div><div class="wait-condition"><i>✓</i><span>已卖 Put / Call 已计入：${quantity(portfolio.putQuantity, assetKey)} / ${quantity(portfolio.callQuantity, assetKey)} ${assetKey}</span></div><div class="wait-condition"><i>✓</i><span>系统建议期限约 ${TERMS[state().term].days} 天</span></div></div></div>${positionsHtml()}`;
  }

  function waitHtml(recommendation) {
    const routeName = routeNameForRecommendation(recommendation);
    const title = recommendation.status === "blocked"
      ? "系统已经阻止这笔交易"
      : recommendation.source === "hold_default"
        ? "保持现状，今天不交易"
        : recommendation.source === "preference"
          ? `那就不做 ${routeName}`
          : `现在先不做 ${routeName}`;
    const conditions = [
      recommendation.recheck || "行情或持仓发生变化后重新检查。",
      recommendation.status === "blocked" ? "硬门未通过前，不生成任何候选。" : "系统不会为了给答案而展示勉强合格的合约。",
      recommendation.source === "preference" ? "权利金不能替代你对交易后果的接受。" : "保持现状也是完整的策略决定。",
    ];
    return `<div class="result-lead"><div class="result-state ${stateClass(recommendation.status)}">${statusLabel(recommendation.status)}</div><div class="result-copy"><span class="section-index">SYSTEM DECISION</span><h2 id="recommendationTitle">${title}</h2><p>${recommendation.reason}</p></div></div>${answerSummary()}${accountContext()}${comparisonExplanation(effectiveDirection(state().direction, state().acceptance))}<div class="wait-panel"><h3>重新开启的条件很明确</h3><p>当前偏好、timing 或可用额度没有同时通过，因此不展示“勉强合格”的合约。</p><div class="wait-conditions">${conditions.map((condition, index) => `<div class="wait-condition"><i>${index + 1}</i><span>${condition}</span></div>`).join("")}</div></div>${reasoningHtml(recommendation, null)}${positionsHtml()}`;
  }

  function tradeHtml(recommendation) {
    const strategy = recommendation.strategy;
    const candidates = candidatesFor(assetKey, recommendation, state().term);
    const primary = candidates[0];
    const activeCandidate = selectedOrPrimary(candidates);
    const progress = deploymentProgressFor(assetKey, strategy, recommendation.size, activeCandidate.strike, activeCandidate.quantity);
    const sizeCap = SIZE_PERCENT[recommendation.size];
    const strategyTitle = strategy === "sell_put" ? "Sell Put" : "Covered Call";
    const actionTitle = strategy === "sell_put" ? `${assetKey} 现在可以卖一笔 Put` : `${assetKey} 现在可以卖一笔 Covered Call`;
    const reason = strategy === "sell_put"
      ? `你希望增加 ${assetKey}，也接受建议价格的经济后果；系统只在授权额度内给方案。`
      : `你愿意让一小部分上涨被封顶；系统只使用可卖的非核心仓位。`;
    return `<div class="result-lead"><div class="result-state ${stateClass(recommendation.status)}">${statusLabel(recommendation.status)}</div><div class="result-copy"><span class="section-index">${strategyTitle} · ${recommendation.size === "trial" ? "试单" : "标准"}额度上限 ${sizeCap}%</span><h2 id="recommendationTitle">${actionTitle}</h2><p>${reason}本次实际使用机动池约 ${Math.round(progress.tradePercent)}%，会受最小交易单位和剩余额度约束。</p></div></div>${recommendation.override ? `<p class="override-note">${recommendation.override}</p>` : ""}${answerSummary()}${accountContext()}${comparisonExplanation(effectiveDirection(state().direction, state().acceptance))}${trancheProgressHtml(recommendation, candidates)}<div class="candidates">${selectedBanner(candidates)}${primaryCandidateHtml(strategy, primary, state().selectedCandidate === primary.id)}<div class="candidate-alts">${candidates.slice(1).map((candidate) => altCandidateHtml(strategy, candidate, state().selectedCandidate === candidate.id)).join("")}</div></div>${recheckHtml(recommendation)}${reasoningHtml(recommendation, activeCandidate)}${positionsHtml()}`;
  }

  function renderRecommendation() {
    const recommendation = recommendationFor(assetKey, state());
    if (recommendation.status === "incomplete") $("recommendationContent").innerHTML = incompleteHtml(recommendation);
    else if (["wait", "blocked"].includes(recommendation.status)) $("recommendationContent").innerHTML = waitHtml(recommendation);
    else $("recommendationContent").innerHTML = tradeHtml(recommendation);
  }

  function render() {
    document.querySelectorAll("[data-asset-label]").forEach((node) => { node.textContent = assetKey; });
    renderProfile();
    renderMarketScan();
    renderDirection();
    renderAcceptance();
    renderSize();
    renderQuestionStates();
    renderTerms();
    renderRecommendation();
  }

  document.addEventListener("click", (event) => {
    const assetButton = event.target.closest("[data-asset]");
    if (assetButton) {
      assetKey = assetButton.dataset.asset;
      comparisonGoal = state().direction
        ? effectiveDirection(state().direction, state().acceptance)
        : ASSETS[assetKey].mandate.direction;
      render();
      return;
    }

    const choice = event.target.closest("[data-choice-group]");
    if (choice && !choice.disabled) {
      const current = state();
      const group = choice.dataset.choiceGroup;
      const value = choice.dataset.value;
      if (applyChoiceToState(current, group, value)) {
        if (group === "direction") comparisonGoal = value;
        if (group === "acceptance" && current.direction === "hold") {
          comparisonGoal = effectiveDirection(current.direction, current.acceptance);
        }
      }
      render();
      return;
    }

    const term = event.target.closest("[data-term]");
    if (term) {
      const current = state();
      if (current.term !== term.dataset.term) {
        current.term = term.dataset.term;
        current.acceptance = current.direction === "hold" ? "none" : null;
        current.size = current.direction === "hold" ? "none" : null;
        current.selectedCandidate = null;
        if (current.direction === "hold") comparisonGoal = "hold";
      }
      render();
      return;
    }

    const candidate = event.target.closest("[data-select-candidate]");
    if (candidate) {
      state().selectedCandidate = candidate.dataset.selectCandidate;
      render();
      return;
    }

    const edit = event.target.closest("[data-edit-step]");
    if (edit) {
      const section = document.querySelector(`[data-step="${edit.dataset.editStep}"]`);
      section?.scrollIntoView({ behavior: "smooth", block: "center" });
      section?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    }
  });

  render();
}

if (typeof document !== "undefined") {
  initBrowserPrototype();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ASSETS,
    DEMO_POSITIONS,
    SIZE_PERCENT,
    TERMS,
    applyChoiceToState,
    acceptanceReferenceFor,
    acceptanceCapsTrial,
    activePosition,
    candidatesFor,
    deploymentProgressFor,
    effectiveDirection,
    effectiveSize,
    opportunityFor,
    portfolioFor,
    q2Config,
    rankOpportunities,
    recommendationFor,
    routeNameForRecommendation,
    roundDown,
    strategyForDirection,
    strategyFromAnswers,
    tradeCapacity,
  };
}
