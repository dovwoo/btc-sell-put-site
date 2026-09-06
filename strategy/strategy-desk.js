"use strict";

(() => {
  const R = window.DecisionRules;
  const $ = id => document.getElementById(id);
  const basePath = window.MANGO_BASE_PATH || "/";
  const apiBase = String(window.MANGO_API_BASE || "https://yvpgdnbcjgxpjqenhvuo.supabase.co/functions/v1/options-api").replace(/\/$/, "");
  const SESSION_KEY = "mango.owner.session.v1";
  const DRAFT_KEY = "mango.strategy.draft.v1";
  const money = n => n === null || n === undefined || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
  const pct = n => n === null || n === undefined ? "—" : `${n.toFixed(1)}%`;
  const time = ms => ms === null || !Number.isFinite(ms) ? "时间未知" : `${new Date(ms).toISOString().replace("T", " ").slice(0, 19)} UTC`;
  const state = { chain: null, timing: null, history: null, receivedAt: null, owner: null, positions: null, ownerId: null, ownerAt: null, selected: null, depth: null, depthAt: null, call: null, callAt: null, depthVersion: 0, loadVersion: 0, ownerVersion: 0, loading: false, hasSearched: false };
  const pending = new Map(), cached = new Map();

  async function json(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { cache: "no-store", ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`数据请求失败 (${response.status})`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  window.MangoMarketSource = Object.freeze({
    getChain(asset, { refresh = false } = {}) {
      if (!["BTC", "ETH", "HYPE"].includes(asset)) return Promise.reject(new Error("不支持的资产"));
      if (pending.has(asset)) return pending.get(asset);
      const old = cached.get(asset);
      if (!refresh && old && R.quoteFresh(old.payload, old.receivedAt)) return Promise.resolve(old);
      const request = json(`${apiBase}/api/options?asset=${asset}`).then(payload => {
        if (payload?.asset !== asset) throw new Error("行情资产不一致");
        const result = { payload, receivedAt: Date.now() };
        cached.set(asset, result);
        window.dispatchEvent(new CustomEvent("mango:chain", { detail: { asset, ...result } }));
        return result;
      }).finally(() => pending.delete(asset));
      pending.set(asset, request);
      return request;
    },
  });

  function session() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (!value?.access_token || !/^[0-9a-f-]{36}$/i.test(value?.user?.id || "") || !Number.isFinite(value.expires_at) || value.expires_at * 1000 <= Date.now()) return null;
      return value;
    } catch { return null; }
  }

  function clearOwner() {
    state.owner = null; state.positions = null; state.ownerId = null; state.ownerAt = null;
    $("accountFigures").replaceChildren();
  }

  async function loadOwner() {
    const version = ++state.ownerVersion;
    clearOwner();
    const auth = session(), config = window.MANGO_OWNER_CONFIG;
    if (!auth || !config?.anonKey || !config?.url) {
      $("accountStatus").textContent = "未连接账户。可研究行情；资金容量与录仓需先登录 Owner。";
      renderReview(); return false;
    }
    $("accountStatus").textContent = "正在同步账户余额和全部未结算义务…";
    renderReview();
    try {
      const root = String(config.url).replace(/\/$/, "");
      const ownerFilter = encodeURIComponent(auth.user.id);
      const headers = { apikey: config.anonKey, Authorization: `Bearer ${auth.access_token}` };
      const [accounts, positions] = await Promise.all([
        json(`${root}/rest/v1/owner_state?select=owner_id,stablecoin_usd,cash_floor_usd,buy_band_low,buy_band_high,updated_at&owner_id=eq.${ownerFilter}`, { headers }),
        json(`${root}/rest/v1/positions?select=id,owner_id,asset,kind,strike,expiry,notional_btc&owner_id=eq.${ownerFilter}&order=expiry.asc`, { headers }),
      ]);
      if (version !== state.ownerVersion || session()?.user.id !== auth.user.id) return false;
      if (!Array.isArray(accounts) || accounts.length > 1 || !Array.isArray(positions) || positions.some(p => p.owner_id !== auth.user.id) || accounts.some(a => a.owner_id !== auth.user.id)) throw new Error("账户返回内容无法核验");
      state.owner = accounts[0] || null; state.positions = positions; state.ownerId = auth.user.id; state.ownerAt = Date.now();
      if (!$("maxStrike").value && R.finite(state.owner?.buy_band_high) > 0) $("maxStrike").value = state.owner.buy_band_high;
      renderOwner(); renderReview(); return true;
    } catch (error) {
      if (version !== state.ownerVersion) return false;
      clearOwner();
      $("accountStatus").textContent = "账户同步失败。请在 Owner 检查登录状态后重新刷新；不以零持仓替代缺失数据。";
      renderReview(); return false;
    }
  }

  function accountReady() {
    const auth = session();
    return auth && auth.user.id === state.ownerId && state.ownerAt !== null && Date.now() - state.ownerAt <= 120000;
  }

  function capacity() { return accountReady() ? R.accountCapacity(state.owner, state.positions) : null; }

  function renderOwner() {
    const node = $("accountFigures"); node.replaceChildren();
    if (!accountReady()) {
      $("accountStatus").textContent = "账户未连接或同步已过期，请刷新或打开 Owner。"; return;
    }
    const rows = state.positions || [];
    const today = new Date().toISOString().slice(0, 10);
    const expired = rows.filter(p => p.expiry < today);
    const expiringToday = rows.filter(p => p.expiry === today);
    const due = rows.filter(p => { const ms = R.timestamp(`${p.expiry}T08:00:00Z`); return ms > Date.now() && ms - Date.now() <= 7 * 86400000; });
    $("accountStatus").textContent = `${rows.length} 笔未结算义务 · ${expired.length} 笔到期待确认 · ${expiringToday.length} 笔今日到期（请打开持仓核对） · ${due.length} 笔临近到期。到期义务在确认结算前继续占用容量。账户记录更新于 ${state.owner?.updated_at || "时间未记录"}。`;
    const cap = capacity();
    if (!cap) {
      $("accountStatus").textContent += " 请在账户设置核对稳定币余额与现金保留额。"; return;
    }
    for (const [label, amount] of [["稳定币余额", cap.cash], ["已有完整义务", cap.committed], ["现金保留额", cap.floor], ["剩余容量", cap.available]]) {
      const item = document.createElement("div"); item.append(`${label} `);
      const value = document.createElement("strong"); value.textContent = money(amount); item.append(value); node.append(item);
    }
    if (cap.deficit > 0) $("accountStatus").textContent += ` 现有资金缺口 ${money(cap.deficit)}，先处理持仓。`;
  }

  function assessment() { return R.marketAssessment(state); }

  function renderMarket() {
    const market = assessment();
    $("verdictTitle").textContent = market.label;
    $("verdictTitle").closest("section").className = `verdict ${market.state}`;
    $("verdictReason").textContent = market.reason;
    $("spotPrice").textContent = money(R.finite(state.chain?.spot_price));
    const chainAge = R.finite(state.chain?.quote_age_seconds);
    const chainAt = state.receivedAt !== null && chainAge !== null ? state.receivedAt - chainAge * 1000 : null;
    $("marketAsOf").textContent = `期权链 ${time(chainAt)} · 波动率 ${time(market.asOf)}`;
    $("contractFamily").textContent = state.chain ? `${state.chain.provider_family || "家族未知"} · ${state.chain.settlement_currency || "未知币种"} 现金结算` : "尚未取得真实合约数据";
    const metrics = [["DVOL / 市场 IV", pct(market.dvol), "约 30 天市场波动定价"], ["30D RV", pct(market.rv), "过去 30 天实现波动"], ["波动率溢价", market.vrp === null ? "—" : `${market.vrp.toFixed(1)} pp`, "DVOL − 30D RV"], ["一年 IV 位置", pct(market.percentile), "历史百分位，不是胜率"], ["IV 是否降温", `${pct(market.change4h)} / ${pct(market.change1d)}`, "4 小时 / 1 日，与行情页同口径"]];
    $("marketReadings").replaceChildren();
    metrics.forEach(([label, value, note]) => {
      const row = document.createElement("div"); row.className = "reading";
      for (const [tag, text] of [["span", label], ["strong", value], ["small", note]]) { const el = document.createElement(tag); el.textContent = text; row.append(el); }
      $("marketReadings").append(row);
    });
    $("recheckCondition").textContent = market.state === "screen" ? "下一步：选择具体合约，核对盘口、费用、资金与损失；市场通过不等于开仓许可。"
      : market.state === "unknown" ? "下次复核：先刷新缺失或过期数据；账户未连接时，录仓流程保持关闭。"
      : "下次复核：市场溢价恢复为正、IV 处于相对高位且 4 小时 / 1 日均降温时，再检查合约；现在仍可手动研究。";
    renderReview();
  }

  function filterValues() {
    const maxStrike = R.finite($("maxStrike").value), minDays = R.finite($("minDays").value), maxDays = R.finite($("maxDays").value);
    return maxStrike > 0 && Number.isInteger(minDays) && Number.isInteger(maxDays) && minDays >= 1 && maxDays >= minDays ? { maxStrike, minDays, maxDays } : null;
  }

  function renderCandidates() {
    const list = $("candidateList"); list.replaceChildren();
    if (!state.hasSearched) return;
    const filters = filterValues();
    if (!filters) { $("candidateStatus").textContent = "请输入正数行权价、整数天数，并保证最短不超过最长。"; return; }
    if (!R.quoteFresh(state.chain, state.receivedAt)) { $("candidateStatus").textContent = "行情缺失或超过 120 秒，请刷新后筛选。"; return; }
    const rows = R.putRows(state.chain).filter(row => row.strike <= filters.maxStrike && row.strike < state.chain.spot_price && row.days >= filters.minDays && row.days <= filters.maxDays)
      .sort((a, b) => b.strike - a.strike || a.days - b.days);
    $("candidateStatus").textContent = rows.length ? `${rows.length} 张真实合约符合价格与期限。按行权价接近程度、再按到期日排列；点击复核，尚未计入费用。` : "当前没有符合条件的真实报价。可以调整价格或期限，也可以保持等待。";
    for (const row of rows.slice(0, 12)) {
      const button = document.createElement("button"); button.type = "button"; button.className = "candidate";
      button.setAttribute("aria-pressed", String(state.selected?.instrument === row.instrument));
      const title = document.createElement("strong"); title.textContent = `${money(row.strike)} Put`;
      const date = document.createElement("small"); date.textContent = `${row.expiry} · ${row.days.toFixed(1)} 天`;
      const info = document.createElement("span"); info.textContent = `链条 Bid ${money(R.finite(row.bid_usd))} / BTC · |Delta| ${R.finite(row.delta) === null ? "—" : Math.abs(row.delta).toFixed(2)} · 点击核验盘口`;
      button.append(title, date, info); button.addEventListener("click", () => selectContract(row)); list.append(button);
    }
    if (rows.length > 12) $("candidateStatus").textContent += " 显示最接近的 12 张，完整报价在行情页。";
  }

  function invalidateSelection() {
    state.selected = null; state.depth = null; state.depthAt = null; state.depthVersion++;
    $("riskAccepted").checked = false; $("reviewInputs").disabled = true; $("refreshDepth").hidden = true;
    $("selectedContract").textContent = "左侧选择后，查询该合约的真实 Bid / Ask 和顶档数量。";
    $("depthStatus").textContent = "";
    renderReview();
  }

  function selectContract(row) {
    state.selected = row; $("riskAccepted").checked = false;
    $("reviewInputs").disabled = false; $("refreshDepth").hidden = false;
    $("selectedContract").textContent = `${row.instrument} · ${row.expiry} 到期 · USDC 现金结算`;
    $("quantity").min = state.chain.min_trade_amount; $("quantity").step = state.chain.min_trade_amount;
    renderCandidates(); loadDepth();
  }

  async function loadDepth() {
    if (!state.selected) return;
    const version = ++state.depthVersion, instrument = state.selected.instrument;
    state.depth = null; state.depthAt = null; $("riskAccepted").checked = false;
    $("depthStatus").textContent = "正在核验所选合约的实时盘口…"; renderReview();
    try {
      const payload = await json(`${apiBase}/api/quote-depth?asset=BTC&instrument=${encodeURIComponent(instrument)}`);
      if (version !== state.depthVersion || state.selected?.instrument !== instrument) return;
      state.depth = payload; state.depthAt = Date.now();
      $("depthStatus").textContent = `盘口 ${payload.quoted_at || "时间未知"} · 顶档容量只是当前观测，不保证成交。`;
    } catch { if (version === state.depthVersion) $("depthStatus").textContent = "盘口加载失败，请重试；不使用旧 Bid 或假定深度。"; }
    if (version === state.depthVersion) renderReview();
  }

  function currentReview() {
    return R.contractReview({ row: state.selected, chain: state.chain, depth: state.depth, depthReceivedAt: state.depthAt, quantity: $("quantity").value, feesUsd: $("feesUsd").value, slippageUsd: $("slippageUsd").value, opportunityApy: $("opportunityApy").value, maxStrike: $("maxStrike").value, capacity: capacity(), market: assessment(), receivedAt: state.receivedAt });
  }

  function renderReview() {
    $("reviewNumbers").replaceChildren(); $("reviewBlockers").replaceChildren();
    $("handoffOwner").disabled = true; $("riskAccepted").disabled = true;
    if (!state.selected) return;
    const review = currentReview();
    const dl = document.createElement("dl");
    const items = [["盘口 Bid / Ask · 每 BTC", `${money(review.bid)} / ${money(review.ask)}`], ["顶档 Bid 数量 · BTC", review.bidSize === null ? "—" : String(review.bidSize)], ["本笔预计权利金", money(review.gross)], ["扣费用与滑点后的条件收入", money(review.net)], ["完整行权金额 K × Q", money(review.capitalUsd)], ["这段期限的机会成本", money(review.opportunityCost)], ["到期盈亏平衡参考价", money(review.breakEven)], ["若到期价格下跌 30% · 本笔盈亏", money(review.down30Pnl)], ["若标的归零 · 最大到期损失", money(review.maximumLoss)]];
    for (const [label, value] of items) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; dl.append(dt, dd); }
    $("reviewNumbers").append(dl);
    const description = document.createElement("p"); description.className = "data-note"; description.textContent = "损益按到期现金结算计算，并扣除你填写的预算；不代表持有期间最大回撤。收入不是预期收益，实际费用可能不同。"; $("reviewNumbers").append(description);
    const heading = document.createElement("strong"); heading.textContent = review.ready ? "数值复核已完成，仍需确认事件与损失后果" : "尚未满足的复核条件"; heading.className = review.ready ? "review-ready" : ""; $("reviewBlockers").append(heading);
    if (review.blockers.length) { const ul = document.createElement("ul"); review.blockers.forEach(message => { const li = document.createElement("li"); li.textContent = message; ul.append(li); }); $("reviewBlockers").append(ul); }
    $("riskAccepted").disabled = !review.ready;
    if (!review.ready) $("riskAccepted").checked = false;
    $("riskAccepted").disabled = !review.ready || Boolean(state.handingOff);
    $("handoffOwner").disabled = !review.ready || !$("riskAccepted").checked || Boolean(state.handingOff);
  }

  function renderCall() {
    const node = $("longCallContext"), market = assessment();
    if (!state.call || !R.quoteFresh(state.call, state.callAt)) { node.textContent = "远期 Call 报价缺失或已过期；当前不形成 Buy Call 结论。"; return; }
    const calls = Object.values(state.call.expiries || {}).flatMap(group => (group.calls || []).map(row => ({ ...row, days: R.finite(row.days ?? group.days) }))).filter(row => row.days > 0 && R.finite(row.ask_usd) > 0);
    const long = calls.filter(row => row.days >= 180 && row.days <= 365).sort((a, b) => Math.abs(a.days - 270) - Math.abs(b.days - 270) || Math.abs((a.delta ?? 0) - .7) - Math.abs((b.delta ?? 0) - .7))[0];
    const max = calls.length ? Math.max(...calls.map(row => row.days)) : null;
    const context = `一年 IV 百分位 ${pct(market.percentile)}。`;
    node.textContent = !long ? `${context}当前没有覆盖 6–12 个月的可用 Call${max === null ? "" : `，链条最长 ${Math.floor(max)} 天`}；期限不足时不输出买入倾向。`
      : `${context}可复核 ${long.instrument || "真实远期 Call"}，剩余 ${Math.floor(long.days)} 天，Ask ${money(R.finite(long.ask_usd))} / BTC，IV ${pct(R.finite(long.iv))}。尚无同期限、同 Delta 历史基准，不能据市场 IV 声称这张 Call 便宜。`;
  }

  async function refresh() {
    const version = ++state.loadVersion;
    state.loading = true; state.chain = null; state.timing = null; state.history = null; state.receivedAt = null; state.call = null; state.callAt = null;
    invalidateSelection(); renderMarket(); renderCandidates(); $("refreshDesk").disabled = true;
    const ownerPromise = loadOwner();
    const results = await Promise.allSettled([
      window.MangoMarketSource.getChain("BTC", { refresh: true }), json(`${apiBase}/api/timing?asset=BTC`), json(`${apiBase}/api/iv-history?asset=BTC&days=365`), json(`${apiBase}/api/buy-call?asset=BTC`),
    ]);
    if (version !== state.loadVersion) return;
    if (results[0].status === "fulfilled") { state.chain = results[0].value.payload; state.receivedAt = results[0].value.receivedAt; }
    if (results[1].status === "fulfilled") state.timing = results[1].value;
    if (results[2].status === "fulfilled") state.history = results[2].value;
    if (results[3].status === "fulfilled" && results[3].value.asset === "BTC") { state.call = results[3].value; state.callAt = Date.now(); }
    state.loading = false; $("refreshDesk").disabled = false;
    renderMarket(); renderCandidates(); renderCall(); await ownerPromise;
  }

  function reviewFingerprint() {
    const market = assessment();
    return JSON.stringify({ instrument: state.selected?.instrument, chainAt: state.receivedAt, depthAt: state.depthAt,
      market: [market.state, market.asOf, market.vrp, market.percentile, market.change4h, market.change1d],
      inputs: ["quantity", "feesUsd", "slippageUsd", "opportunityApy", "maxStrike", "minDays", "maxDays"].map(id => $(id).value),
      ownerId: state.ownerId, capacity: capacity() });
  }

  function setHandoffBusy(busy) {
    state.handingOff = busy;
    $("reviewInputs").disabled = busy || !state.selected;
    $("candidateForm").querySelectorAll("input,button").forEach(el => { el.disabled = busy; });
    $("candidateList").querySelectorAll("button").forEach(el => { el.disabled = busy; });
    $("refreshDesk").disabled = busy || state.loading;
    $("refreshDepth").disabled = busy;
    $("riskAccepted").disabled = busy;
    $("handoffOwner").disabled = busy;
  }

  async function handoff() {
    if (!state.selected || !currentReview().ready || !$("riskAccepted").checked) return;
    const acceptedFingerprint = reviewFingerprint();
    setHandoffBusy(true);
    try {
    $("handoffOwner").disabled = true; $("handoffStatus").textContent = "正在最后同步账户容量…";
    if (!await loadOwner()) { $("handoffStatus").textContent = "账户未能核验，请重新登录后复核。"; return; }
    const review = currentReview(), market = assessment();
    if (!review.ready || reviewFingerprint() !== acceptedFingerprint) { $("handoffStatus").textContent = "复核条件或账户容量已变化，请重新确认。"; return; }
    const id = crypto.randomUUID(), createdAt = new Date().toISOString();
    const quantity = R.finite($("quantity").value);
    const reason = `策略台复核 ${createdAt}；最高接受行权价 ${$("maxStrike").value} USD；市场 VRP ${market.vrp} pp；按 ${quantity} BTC 估算净收入 ${money(review.net)}、完整行权金额 ${money(review.capitalUsd)}；费用与滑点预算 ${money(R.finite($("feesUsd").value) + R.finite($("slippageUsd").value))}。已人工检查事件及现金结算风险。候选报价不是成交记录。`;
    const draft = { version: 1, id, createdAt, ownerId: state.ownerId, asset: "BTC", kind: "sell_put", instrument: state.selected.instrument, strike: state.selected.strike, expiry: state.selected.expiry, notional_btc: quantity, venue: "deribit", reason_text: reason,
      marketSnapshot: { asOf: new Date(market.asOf).toISOString(), spot: state.chain.spot_price, dvol: market.dvol, rv: market.rv, vrp: market.vrp, percentile: market.percentile, change4h: market.change4h, change1d: market.change1d },
      quoteSnapshot: { asOf: new Date(state.depthAt - (R.finite(state.depth.quote_age_seconds) || 0) * 1000).toISOString(), bid: review.bid, ask: review.ask, netPremiumUsd: review.net, feesUsd: R.finite($("feesUsd").value), slippageUsd: R.finite($("slippageUsd").value), capitalUsd: review.capitalUsd } };
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
    catch { $("handoffStatus").textContent = "浏览器无法保存临时草稿，请打开 Owner 手动录入。"; renderReview(); return; }
    window.location.assign(`${basePath}owner/?strategy-draft=${encodeURIComponent(id)}`);
    } finally { setHandoffBusy(false); renderReview(); }
  }

  $("candidateForm").addEventListener("submit", event => { event.preventDefault(); state.hasSearched = true; invalidateSelection(); renderCandidates(); });
  ["maxStrike", "minDays", "maxDays"].forEach(id => $(id).addEventListener("input", () => { invalidateSelection(); state.hasSearched = false; $("candidateList").replaceChildren(); $("candidateStatus").textContent = "条件已变化，请重新筛选。"; }));
  ["quantity", "feesUsd", "slippageUsd", "opportunityApy"].forEach(id => $(id).addEventListener("input", () => { $("riskAccepted").checked = false; renderReview(); }));
  $("riskAccepted").addEventListener("change", renderReview);
  $("refreshDesk").addEventListener("click", refresh); $("refreshDepth").addEventListener("click", loadDepth); $("handoffOwner").addEventListener("click", handoff);
  window.addEventListener("mango:chain", event => {
    if (event.detail?.asset !== "BTC" || state.loading) return;
    state.chain = event.detail.payload; state.receivedAt = event.detail.receivedAt;
    invalidateSelection(); renderMarket(); renderCandidates();
  });
  window.addEventListener("storage", event => { if (event.key === SESSION_KEY) { clearOwner(); $("riskAccepted").checked = false; loadOwner(); } });
  setInterval(() => { renderMarket(); renderOwner(); renderCall(); if (state.hasSearched && !R.quoteFresh(state.chain, state.receivedAt)) renderCandidates(); }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { renderMarket(); renderOwner(); renderCall(); } });
  refresh();
})();
