(function(){
  "use strict";

  const marker="/owner";
  const markerIndex=window.location.pathname.indexOf(marker);
  if(markerIndex<0)return;
  document.documentElement.classList.add("owner-route");

  const Strategy=window.OwnerStrategy;
  if(!Strategy)throw new Error("OwnerStrategy is required");
  const projectBase=window.location.pathname.slice(0,markerIndex);
  const ownerBase=`${projectBase}/owner/`;
  const ownerSuffix=window.location.pathname.slice(markerIndex+marker.length)
    .replace(/^\/+|\/+$/g,"");
  const positionsRoute=ownerSuffix==="";
  const SESSION_KEY="mango.owner.session.v1";
  const DRAFT_KEY="mango.owner.position-draft.v1";
  const ACCOUNT_DRAFT_KEY="mango.owner.account-draft.v1";
  const PROJECT_URL="https://yvpgdnbcjgxpjqenhvuo.supabase.co";
  const config=window.MANGO_OWNER_CONFIG||{};
  const supabaseUrl=String(config.url||PROJECT_URL).replace(/\/$/,"");
  const anonKey=String(config.anonKey||config.publishableKey||"").trim();

  let session=null;
  let ownerState={
    owner_id:null,stablecoin_usd:0,buy_band_low:null,buy_band_high:null,
    cash_floor_usd:null,updated_at:null,
  };
  let positions=[];
  let research=null;
  let privateReady=false;
  let privateError=null;
  let refreshController=null;
  let refreshVersion=0;
  let saveTimer=null;
  let refreshTimer=null;
  let authTimer=null;
  let lastResearchAt=0;
  let privateLoadVersion=0;
  let stateSaveVersion=0;
  let stateSaveQueue=Promise.resolve();

  const $=id=>document.getElementById(id);
  const money=(value,decimals=0)=>{
    const number=Number(value);
    return Number.isFinite(number)
      ?`$${number.toLocaleString("en-US",{minimumFractionDigits:decimals,maximumFractionDigits:decimals})}`
      :"—";
  };
  const pct=(value,decimals=1)=>{
    const number=Number(value);
    return Number.isFinite(number)?`${number.toFixed(decimals)}%`:"—";
  };
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
  })[char]);
  const inputValue=value=>value==null?"":String(value);

  function readStoredJson(key){
    try{return JSON.parse(localStorage.getItem(key)||"null")}
    catch(_){return null}
  }

  function readStoredSession(){
    const value=readStoredJson(SESSION_KEY);
    if(!value?.access_token||!value?.refresh_token||!value?.user?.id)return null;
    return value;
  }

  function persistSession(value){
    session=value;
    if(value)localStorage.setItem(SESSION_KEY,JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
    scheduleAuthRefresh();
  }

  function normalizeAuthPayload(payload){
    if(!payload?.access_token||!payload?.refresh_token||!payload?.user?.id){
      throw new Error("登录响应不完整");
    }
    const expiresAt=Number(payload.expires_at)||
      Math.floor(Date.now()/1000)+Number(payload.expires_in||3600);
    return {...payload,expires_at:expiresAt};
  }

  async function authRequest(path,body){
    if(!anonKey)throw new Error("Owner 登录配置尚未完成");
    const response=await fetch(`${supabaseUrl}/auth/v1/${path}`,{
      method:"POST",
      cache:"no-store",
      headers:{apikey:anonKey,"content-type":"application/json"},
      body:JSON.stringify(body),
    });
    let payload={};
    try{payload=await response.json()}catch(_){}
    if(!response.ok)throw new Error(payload.error_description||payload.msg||payload.error||"登录失败");
    return payload;
  }

  async function refreshSession(){
    if(!session?.refresh_token)throw new Error("登录已失效");
    const payload=await authRequest("token?grant_type=refresh_token",{
      refresh_token:session.refresh_token,
    });
    persistSession(normalizeAuthPayload(payload));
    return session;
  }

  async function ensureSession(){
    if(!session)session=readStoredSession();
    if(!session)throw new Error("请先登录");
    if(Number(session.expires_at)*1000-Date.now()<60000)await refreshSession();
    return session;
  }

  function scheduleAuthRefresh(){
    clearTimeout(authTimer);
    if(!session)return;
    const wait=Math.max(1000,Number(session.expires_at)*1000-Date.now()-60000);
    authTimer=setTimeout(()=>{
      refreshSession().catch(()=>showLogin("登录已失效，请重新登录。"));
    },wait);
  }

  async function rest(path,{method="GET",body=null,prefer="",retry=true}={}){
    await ensureSession();
    const headers={apikey:anonKey,Authorization:`Bearer ${session.access_token}`};
    if(body!==null)headers["content-type"]="application/json";
    if(prefer)headers.Prefer=prefer;
    const response=await fetch(`${supabaseUrl}/rest/v1/${path}`,{
      method,headers,cache:"no-store",body:body===null?undefined:JSON.stringify(body),
    });
    if(response.status===401&&retry){
      try{await refreshSession()}
      catch(_){
        const error=new Error("登录已失效");
        error.status=401;
        throw error;
      }
      return rest(path,{method,body,prefer,retry:false});
    }
    let payload=null;
    if(response.status!==204){
      try{payload=await response.json()}catch(_){}
    }
    if(!response.ok){
      const message=payload?.message||payload?.hint||payload?.details||`HTTP ${response.status}`;
      const error=new Error(message);
      error.status=response.status;
      throw error;
    }
    return payload;
  }

  function showLogin(message=""){
    privateLoadVersion++;
    stateSaveVersion++;
    clearInterval(refreshTimer);
    refreshTimer=null;
    refreshController?.abort();
    persistSession(null);
    privateReady=false;
    privateError=null;
    positions=[];
    ownerState={
      owner_id:null,stablecoin_usd:0,buy_band_low:null,buy_band_high:null,
      cash_floor_usd:null,updated_at:null,
    };
    window.MangoOwner.isActive=false;
    document.documentElement.classList.remove("owner-authenticated");
    document.documentElement.classList.remove("owner-pending");
    const dialog=$("ownerPositionDialog");
    if(dialog?.open){
      if(dialog.close)dialog.close();
      else dialog.removeAttribute("open");
    }
    $("ownerLoginError").textContent=message;
    $("ownerLoginEmail").focus();
  }

  function showOwner(){
    document.documentElement.classList.add("owner-authenticated");
    document.documentElement.classList.toggle("owner-positions-route",positionsRoute);
    document.documentElement.classList.remove("owner-pending");
    window.MangoOwner.isActive=true;
  }

  function configureNavigation(){
    $("sellPutNav").href=`${ownerBase}options/`;
    $("buyCallNav").href=`${ownerBase}buy-call/`;
    const nav=$("sellPutNav").parentElement;
    if(!$("ownerPositionsNav")){
      const link=document.createElement("a");
      link.id="ownerPositionsNav";
      link.href=ownerBase;
      link.textContent="持仓";
      nav.appendChild(link);
    }
    if(positionsRoute){
      $("sellPutNav").classList.remove("on");
      $("buyCallNav").classList.remove("on");
      $("ownerPositionsNav").classList.add("on");
      $("ownerPositionsNav").setAttribute("aria-current","page");
      $("pageTitle").textContent="BTC Sell Put · 持仓";
      document.title="BTC Sell Put Owner";
    }
  }

  function installOwnerUi(){
    configureNavigation();
    const main=document.querySelector("main.wrap");
    if(!$("ownerAccountBar")){
      const account=document.createElement("section");
      account.id="ownerAccountBar";
      account.className="owner-account-bar";
      account.setAttribute("aria-label","Owner 账户");
      main.prepend(account);
    }
    if(!$("ownerEntryCard")){
      const entry=document.createElement("section");
      entry.id="ownerEntryCard";
      entry.className="owner-entry-card";
      entry.setAttribute("aria-live","polite");
      const marketMeta=$("marketMeta");
      marketMeta.insertAdjacentElement("afterend",entry);
    }
    if(!$("ownerPositionsPage")){
      const page=document.createElement("section");
      page.id="ownerPositionsPage";
      page.className="owner-positions-page";
      main.appendChild(page);
    }
    if(!$("ownerPositionDialog")){
      document.body.insertAdjacentHTML("beforeend",positionDialogHtml());
      bindPositionDialog();
    }
    renderAccount();
    renderPositions();
  }

  function accountHtml(){
    const account=Strategy.totals(ownerState,positions);
    const capital=Strategy.deribitCapitalSummary(positions,research);
    const age=research?.source_status?.chain_asof_epoch_ms
      ?Math.max(0,Math.round((Date.now()-research.source_status.chain_asof_epoch_ms)/1000))
      :null;
    const stale=!Strategy.sourceUsable(research);
    let capitalBody;
    if(!positions.length){
      capitalBody='<p class="owner-capital-note">录入持仓后显示当前 Deribit Standard Margin 文档估算。</p>';
    }else if(!capital.complete){
      capitalBody='<p class="owner-capital-note">需要新鲜的 BTC 现价与每笔合约 Mark，当前暂不估算保证金。</p>';
    }else{
      capitalBody=`<div class="owner-capital-grid">
          <div><span>完整经济资本 K×Q</span><strong>${money(capital.capacity_capital)}</strong></div>
          <div><span>净自有资本</span><strong>${money(capital.net_own_capital)}</strong></div>
          <div><span>Deribit 文档 IM</span><strong>${money(capital.initial_margin)}</strong></div>
          <div><span>Deribit 文档 MM</span><strong>${money(capital.maintenance_margin)}</strong></div>
          <div><span>IM 以上专属准备金</span><strong>${money(capital.above_im_dedicated_reserve)}</strong></div>
        </div>
        <p class="owner-capital-note">这是 BTC_USDC Standard Margin 的文档公式估算，不是账户下单预览。“IM 以上专属准备金”可以放在合格生息抵押品或高流动性短债，但仍专属于这些 Put，不能再次计入开仓容量；可转出金额还要扣除 -70% 压力、参数上调、haircut 与 48 小时入金中断缓冲。</p>`;
    }
    return `<div class="owner-account-head"><div><span class="owner-kicker">OWNER / BTC SELL PUT</span><strong>完整承诺账本</strong></div><div class="owner-account-actions"><span class="owner-save-state" id="ownerSaveState"></span><button type="button" id="ownerRetry" class="owner-quiet">刷新</button><button type="button" id="ownerLogout" class="owner-quiet">退出</button></div></div>
      <div class="owner-account-grid">
        <label><span>稳定币 USD</span><input id="ownerStablecoin" type="number" min="0" step="any" inputmode="decimal" value="${esc(inputValue(ownerState.stablecoin_usd))}"></label>
        <div class="owner-account-metric"><span>Put 占用 K×Q</span><strong>${money(account.put_reserved)}</strong></div>
        <div class="owner-account-metric ${account.available<0?"bad":""}"><span>可用容量</span><strong>${money(account.available)}</strong></div>
        <div class="owner-account-metric ${stale?"warn":""}"><span>报价年龄</span><strong>${age===null?"—":`${age}s`}</strong></div>
        <label><span>买入带下沿</span><input id="ownerBandLow" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="未配置" value="${esc(inputValue(ownerState.buy_band_low))}"></label>
        <label><span>买入带上沿</span><input id="ownerBandHigh" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="未配置" value="${esc(inputValue(ownerState.buy_band_high))}"></label>
        <label><span>现金底线</span><input id="ownerCashFloor" type="number" min="0" step="any" inputmode="decimal" placeholder="未配置" value="${esc(inputValue(ownerState.cash_floor_usd))}"></label>
      </div>
      <details class="owner-capital"><summary><span>保证金与生息准备金</span><span>默认折叠 · 研究估算</span></summary>${capitalBody}</details>
      <div class="owner-private-error" id="ownerPrivateError"${privateError?"":" hidden"}>${privateError?`${esc(privateError)} <button type="button" data-owner-retry>重试</button>`:""}</div>`;
  }

  function renderAccount(){
    const node=$("ownerAccountBar");
    if(!node)return;
    node.innerHTML=accountHtml();
    const disabled=!privateReady;
    node.querySelectorAll("input").forEach(input=>input.disabled=disabled);
    $("ownerLogout").addEventListener("click",logout);
    $("ownerRetry").addEventListener("click",refreshAll);
    node.querySelector("[data-owner-retry]")?.addEventListener("click",loadPrivateData);
    ["ownerStablecoin","ownerBandLow","ownerBandHigh","ownerCashFloor"].forEach(id=>{
      $(id).addEventListener("input",scheduleOwnerStateSave);
      $(id).addEventListener("change",saveOwnerState);
    });
  }

  function accountDraftFromInputs(){
    return {
      owner_id:session?.user?.id,
      stablecoin_usd:$("ownerStablecoin").value,
      buy_band_low:$("ownerBandLow").value,
      buy_band_high:$("ownerBandHigh").value,
      cash_floor_usd:$("ownerCashFloor").value,
    };
  }

  function scheduleOwnerStateSave(){
    clearTimeout(saveTimer);
    localStorage.setItem(ACCOUNT_DRAFT_KEY,JSON.stringify(accountDraftFromInputs()));
    $("ownerSaveState").textContent="未保存";
    saveTimer=setTimeout(saveOwnerState,600);
  }

  function saveOwnerState(){
    clearTimeout(saveTimer);
    if(!privateReady)return Promise.resolve();
    const status=$("ownerSaveState");
    const draft=accountDraftFromInputs();
    const sessionOwnerId=session?.user?.id;
    const version=++stateSaveVersion;
    status.classList.remove("bad");
    status.textContent="保存中…";
    stateSaveQueue=stateSaveQueue.then(async()=>{
      if(!sessionOwnerId||session?.user?.id!==sessionOwnerId)return;
      const normalized=Strategy.normalizeOwnerState(draft);
      const rows=await rest("owner_state?on_conflict=owner_id",{
        method:"POST",
        body:normalized,
        prefer:"resolution=merge-duplicates,return=representation",
      });
      if(version!==stateSaveVersion||session?.user?.id!==sessionOwnerId)return;
      ownerState=Strategy.normalizeOwnerState(rows?.[0]||normalized);
      localStorage.removeItem(ACCOUNT_DRAFT_KEY);
      status.classList.remove("bad");
      status.textContent="已保存";
      renderPositions();
      renderEntry();
      setTimeout(()=>{if(status.isConnected)status.textContent=""},1400);
    }).catch(error=>{
      if(version!==stateSaveVersion)return;
      status.textContent=error.message;
      status.classList.add("bad");
    });
    return stateSaveQueue;
  }

  function statusClass(state){
    return state==="review"?"warn":state==="risk"?"bad":state==="unknown"?"bad":"muted";
  }

  function renderEntry(){
    const node=$("ownerEntryCard");
    if(!node)return;
    if(ownerSuffix==="buy-call"||ownerSuffix==="buy-call/"){
      node.hidden=true;
      return;
    }
    node.hidden=false;
    let decision;
    if(!privateReady){
      decision={state:"unknown",verdict:"暂无法判断",reason:privateError||"私有账户数据正在加载。"};
    }else try{
      decision=Strategy.evaluateEntry(
        ownerState,positions,research,window.MangoDashboard?.getState()?.timing,
      );
    }catch(_){
      decision={state:"unknown",verdict:"暂无法判断",reason:"私有账户数据暂不可用。"};
    }
    node.className=`owner-entry-card ${statusClass(decision.state)}`;
    node.innerHTML=`<span>开仓复核</span><strong>${esc(decision.verdict)}</strong><p>${esc(decision.reason)}</p>`;
  }

  function researchCard(positionValue){
    const item=(research?.puts||[]).find(candidate=>
      String(candidate.expiry)===String(positionValue.expiry)&&
      Math.abs(Number(candidate.strike)-Number(positionValue.strike))<1e-8
    );
    if(!item?.card)return `<p class="owner-empty">当前链上没有匹配合约，暂无法生成高级研究。</p>`;
    const card=item.card;
    const expected=card.expected||{};
    const stress=(card.stress||[]).map(row=>`<tr><td>${row.shock_pct>0?"+":""}${row.shock_pct}%</td><td>${money(row.terminal_price)}</td><td class="${Number(row.horizon_return_pct)<0?"bad":""}">${pct(row.horizon_return_pct)}</td><td>${money(row.pnl)}</td></tr>`).join("");
    return `<div class="owner-research-grid">
        <div><span>条件净 APR</span><strong>${pct(card.net_conditional_apr_pct)}</strong></div>
        <div><span>8% 门槛条件超额</span><strong>${pct(card.conditional_excess_rwa_apr_pct)}</strong></div>
        <div><span>历史 ITM 概率</span><strong>${pct(expected.itm_probability_pct)}</strong></div>
        <div><span>经验期望净 APR</span><strong>${pct(expected.expected_net_apr_pct)}</strong></div>
        <div><span>CVaR95 持有期</span><strong class="bad">${pct(expected.cvar95_horizon_return_pct)}</strong></div>
        <div><span>单周期几何年化</span><strong>${pct(expected.single_cycle_geometric_annualized_pct)}</strong></div>
      </div>
      <div class="owner-research-table"><table><thead><tr><th>BTC 路径</th><th>到期价</th><th>持有期回报</th><th>损益</th></tr></thead><tbody>${stress}</tbody></table></div>
      <p class="owner-research-note">条件 APR 只表示到期未赔付时的收入率；经验分布与压力路径用于人工复核。</p>`;
  }

  function positionRow(positionValue,now){
    const decision=Strategy.evaluateClose(positionValue,ownerState,positions,research,now);
    const metrics=decision.metrics||Strategy.positionMetrics(positionValue,research,now);
    const expired=Strategy.isExpired(positionValue,now);
    const reserved=positionValue.strike*positionValue.notional_btc;
    return `<tr class="${expired?"owner-expired":""}">
      <td><strong>${money(positionValue.strike)}</strong>${expired?'<span class="owner-expired-tag">待核对到期</span>':""}</td>
      <td>${esc(positionValue.expiry)}<span class="cell-note">${metrics.dte.toFixed(0)} DTE</span></td>
      <td>${positionValue.notional_btc.toLocaleString()} BTC</td>
      <td>${money(reserved)}<span class="cell-note">净资本 ${money(metrics.net_own_capital)}</span></td>
      <td>${money(positionValue.open_premium_per_btc,2)}</td>
      <td>${money(metrics.current_bid,2)}</td>
      <td>${pct(metrics.capture_pct)}<span class="cell-note">期限 ${pct(metrics.time_elapsed_pct)}</span></td>
      <td><span class="owner-status ${statusClass(decision.state)}">${esc(decision.verdict)}</span><span class="owner-reason">${esc(decision.reason)}</span></td>
      <td><button type="button" class="owner-link" data-owner-edit="${esc(positionValue.id)}"${privateReady?"":" disabled"}>编辑</button><button type="button" class="owner-link bad" data-owner-delete="${esc(positionValue.id)}"${privateReady?"":" disabled"}>删除</button></td>
    </tr>`;
  }

  function renderPositions(){
    const page=$("ownerPositionsPage");
    if(!page)return;
    if(!positionsRoute){page.hidden=true;return}
    page.hidden=false;
    const entryCard=$("ownerEntryCard");
    const now=Date.now();
    const sorted=[...positions].sort((a,b)=>
      Number(Strategy.isExpired(b,now))-Number(Strategy.isExpired(a,now))||
      String(a.expiry).localeCompare(String(b.expiry))
    );
    const rows=sorted.length?sorted.map(row=>positionRow(row,now)).join(""):
      `<tr><td colspan="9" class="owner-empty">还没有持仓。可以从 Sell Put 行情页加入，或手动录入。</td></tr>`;
    const studies=sorted.map(row=>`<details class="owner-research-card"><summary><span>${money(row.strike)} Put · ${esc(row.expiry)}</span><span>展开高级研究</span></summary>${researchCard(row)}</details>`).join("");
    page.innerHTML=`<div class="owner-page-head"><div><span class="owner-kicker">POSITIONS</span><h2>BTC Sell Put 持仓</h2><p>每笔只显示一个最高优先级状态；“进入复核”不是交易指令。</p></div><button type="button" class="owner-primary" id="ownerManualAdd"${privateReady?"":" disabled"}>手动录入</button></div>
      ${privateReady?"":`<div class="owner-private-error">${esc(privateError||"私有数据正在加载，编辑暂停。")}</div>`}
      <div class="owner-entry-slot"></div>
      <div class="owner-table-scroll"><table class="owner-position-table"><thead><tr><th>Strike</th><th>到期 / DTE</th><th>名义数量</th><th>K×Q 占用</th><th>开仓权利金</th><th>当前 Bid</th><th>捕获 / 时间</th><th>平仓复核</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
      <section class="owner-advanced"><div class="owner-section-label">高级研究 · 默认折叠</div>${studies||'<p class="owner-empty">录入持仓后显示。</p>'}</section>`;
    if(entryCard)page.querySelector(".owner-entry-slot").appendChild(entryCard);
    $("ownerManualAdd")?.addEventListener("click",()=>openPositionDialog());
    page.querySelectorAll("[data-owner-edit]").forEach(button=>button.addEventListener("click",()=>{
      openPositionDialog(positions.find(row=>row.id===button.dataset.ownerEdit));
    }));
    page.querySelectorAll("[data-owner-delete]").forEach(button=>button.addEventListener("click",()=>deletePosition(button.dataset.ownerDelete)));
  }

  function positionDialogHtml(){
    return `<dialog id="ownerPositionDialog" class="owner-dialog"><form id="ownerPositionForm" method="dialog"><div class="owner-dialog-head"><div><span class="owner-kicker">SELL PUT LEDGER</span><h2 id="ownerDialogTitle">加入持仓</h2></div><button type="button" class="owner-dialog-close" id="ownerDialogClose" aria-label="关闭">×</button></div><input type="hidden" id="ownerPositionId"><div class="owner-form-grid">
      <label><span>Strike</span><input id="ownerPositionStrike" type="number" min="0" step="any" required></label>
      <label><span>到期日</span><input id="ownerPositionExpiry" type="date" required></label>
      <label><span>BTC 名义数量</span><input id="ownerPositionNotional" type="number" min="0.00000001" step="any" value="1" required></label>
      <label><span>开仓权利金 / 1 BTC</span><input id="ownerPositionPremium" type="number" min="0" step="any" required></label>
      <label><span>开仓日期</span><input id="ownerPositionOpenDate" type="date" required></label>
    </div><p class="owner-form-note">Deribit BTC_USDC · USDC 现金结算。权利金可修改；容量始终按 K×Q。</p><div class="owner-dialog-error" id="ownerDialogError"></div><div class="owner-dialog-actions"><button type="button" class="owner-quiet" id="ownerDialogCancel">取消</button><button type="submit" class="owner-primary" id="ownerDialogSave">保存</button></div></form></dialog>`;
  }

  function bindPositionDialog(){
    $("ownerDialogClose").addEventListener("click",closePositionDialog);
    $("ownerDialogCancel").addEventListener("click",closePositionDialog);
    $("ownerPositionForm").addEventListener("submit",event=>{
      event.preventDefault();
      savePosition();
    });
    $("ownerPositionForm").addEventListener("input",()=>{
      localStorage.setItem(DRAFT_KEY,JSON.stringify(positionDraft()));
    });
  }

  function today(){return new Date().toISOString().slice(0,10)}

  function positionDraft(){
    return {
      id:$("ownerPositionId").value||"draft",
      asset:"BTC",kind:"sell_put",
      strike:$("ownerPositionStrike").value,
      expiry:$("ownerPositionExpiry").value,
      notional_btc:$("ownerPositionNotional").value,
      open_premium_per_btc:$("ownerPositionPremium").value,
      open_date:$("ownerPositionOpenDate").value,
    };
  }

  function openPositionDialog(existing=null,prefill=null){
    const draft=!existing&&!prefill?readStoredJson(DRAFT_KEY):null;
    const row=existing||prefill||draft||{};
    $("ownerDialogTitle").textContent=existing?"编辑持仓":"加入持仓";
    $("ownerPositionId").value=existing?.id||"";
    $("ownerPositionStrike").value=inputValue(row.strike);
    $("ownerPositionExpiry").value=row.expiry||"";
    $("ownerPositionNotional").value=inputValue(row.notional_btc??1);
    $("ownerPositionPremium").value=inputValue(row.open_premium_per_btc??row.bid_usd??0);
    $("ownerPositionOpenDate").value=row.open_date||today();
    $("ownerDialogError").textContent="";
    const dialog=$("ownerPositionDialog");
    if(dialog.showModal)dialog.showModal();
    else dialog.setAttribute("open","");
  }

  function closePositionDialog(){
    const dialog=$("ownerPositionDialog");
    if(dialog.close)dialog.close();
    else dialog.removeAttribute("open");
  }

  async function savePosition(){
    const button=$("ownerDialogSave");
    const errorNode=$("ownerDialogError");
    try{
      const draft=positionDraft();
      const normalized=Strategy.normalizePosition(draft);
      const body={
        owner_id:session.user.id,asset:"BTC",kind:"sell_put",
        strike:normalized.strike,expiry:normalized.expiry,
        notional_btc:normalized.notional_btc,
        open_premium_per_btc:normalized.open_premium_per_btc,
        open_date:normalized.open_date,
      };
      button.disabled=true;
      button.textContent="保存中…";
      const id=$("ownerPositionId").value;
      const rows=await rest(
        id?`positions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${session.user.id}`:"positions",
        {method:id?"PATCH":"POST",body,prefer:"return=representation"},
      );
      if(!rows?.length)throw new Error("持仓没有保存成功");
      localStorage.removeItem(DRAFT_KEY);
      closePositionDialog();
      await loadPrivateData();
    }catch(error){
      errorNode.textContent=error.message;
    }finally{
      button.disabled=false;
      button.textContent="保存";
    }
  }

  async function deletePosition(id){
    const row=positions.find(position=>position.id===id);
    if(!row||!confirm(`删除 ${money(row.strike)} Put · ${row.expiry}？请先确认现金结算或记账状态。`))return;
    try{
      await rest(`positions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${session.user.id}`,{
        method:"DELETE",prefer:"return=minimal",
      });
      await loadPrivateData();
    }catch(error){privateError=error.message;renderAccount()}
  }

  async function loadPrivateData(){
    const version=++privateLoadVersion;
    const sessionOwnerId=session?.user?.id;
    privateError=null;
    privateReady=false;
    renderAccount();
    renderPositions();
    renderEntry();
    try{
      const [stateRows,positionRows]=await Promise.all([
        rest(`owner_state?select=*&owner_id=eq.${session.user.id}&limit=1`),
        rest(`positions?select=*&owner_id=eq.${session.user.id}&order=expiry.asc,created_at.asc`),
      ]);
      if(version!==privateLoadVersion||session?.user?.id!==sessionOwnerId)return;
      let stateRow=stateRows?.[0];
      if(!stateRow){
        const created=await rest("owner_state",{
          method:"POST",body:{owner_id:sessionOwnerId,stablecoin_usd:0},
          prefer:"return=representation",
        });
        stateRow=created?.[0];
      }
      if(version!==privateLoadVersion||session?.user?.id!==sessionOwnerId)return;
      ownerState=Strategy.normalizeOwnerState(stateRow||{});
      positions=(positionRows||[]).map(Strategy.normalizePosition);
      privateReady=true;
      const accountDraft=readStoredJson(ACCOUNT_DRAFT_KEY);
      if(accountDraft){
        try{
          ownerState=Strategy.normalizeOwnerState({
            ...ownerState,...accountDraft,owner_id:sessionOwnerId,
          });
        }catch(_){
          privateError="本地账户草稿无效，已保留但未应用。";
        }
      }
    }catch(error){
      if(version!==privateLoadVersion||session?.user?.id!==sessionOwnerId)return;
      privateError=error.status===401?"登录已失效。":"私有数据暂不可用，请重试。";
      if(error.status===401){showLogin(privateError);return}
    }
    renderAccount();
    renderPositions();
    renderEntry();
    window.MangoDashboard?.rerender?.();
  }

  function researchUrl(){
    return window.MangoDashboard?.apiUrl?.("/api/owner-research","BTC")||
      `${projectBase}/api/owner-research?asset=BTC`;
  }

  async function refreshResearch(force=false){
    if(!force&&Date.now()-lastResearchAt<5000)return;
    const version=++refreshVersion;
    if(refreshController)refreshController.abort();
    refreshController=new AbortController();
    try{
      const response=await fetch(researchUrl(),{
        signal:refreshController.signal,cache:"no-store",
      });
      const payload=await response.json();
      if(version!==refreshVersion)return;
      if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      research=payload;
      lastResearchAt=Date.now();
      renderAccount();
      renderPositions();
      renderEntry();
      window.MangoDashboard?.rerender?.();
    }catch(error){
      if(error.name==="AbortError"||version!==refreshVersion)return;
      research=null;
      renderAccount();
      renderPositions();
      renderEntry();
    }
  }

  function refreshAll(){
    window.MangoDashboard?.refresh?.();
    loadPrivateData();
    refreshResearch(true);
  }

  function scheduleRefresh(){
    clearInterval(refreshTimer);
    if(document.hidden)return;
    refreshTimer=setInterval(()=>refreshResearch(true),120000);
  }

  function chainHeader(){
    return window.MangoOwner.isActive&&privateReady?"<th>Owner</th>":"";
  }

  function chainCell(row){
    if(!window.MangoOwner.isActive||!privateReady)return "";
    const matches=positions.filter(position=>
      String(position.expiry)===String(row.expiry)&&
      Math.abs(Number(position.strike)-Number(row.strike))<1e-8
    );
    const payload=encodeURIComponent(JSON.stringify({
      strike:Number(row.strike),expiry:String(row.expiry),
      bid_usd:Number(row.bid_usd)||0,
    }));
    return `<td class="owner-chain-action">${matches.length?`<span class="owner-holding-badge">持仓 ${matches.length}</span>`:""}<button type="button" class="owner-link" data-owner-add="${payload}">加入持仓</button></td>`;
  }

  function bindGlobalActions(){
    document.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-owner-add]");
      if(!button||!window.MangoOwner.isActive)return;
      try{openPositionDialog(null,JSON.parse(decodeURIComponent(button.dataset.ownerAdd)))}catch(_){}
    });
    document.addEventListener("mango:market-data",()=>{
      renderEntry();
      if(Date.now()-lastResearchAt>30000)refreshResearch();
    });
    document.addEventListener("visibilitychange",()=>{
      if(!document.hidden){loadPrivateData();refreshResearch(true);scheduleRefresh()}
      else scheduleRefresh();
    });
  }

  async function login(event){
    event.preventDefault();
    const button=$("ownerLoginSubmit");
    const errorNode=$("ownerLoginError");
    errorNode.textContent="";
    button.disabled=true;
    button.textContent="登录中…";
    try{
      const payload=await authRequest("token?grant_type=password",{
        email:$("ownerLoginEmail").value.trim(),
        password:$("ownerLoginPassword").value,
      });
      persistSession(normalizeAuthPayload(payload));
      $("ownerLoginPassword").value="";
      await bootAuthenticated();
    }catch(error){errorNode.textContent=error.message}
    finally{button.disabled=false;button.textContent="登录"}
  }

  async function logout(){
    try{
      if(session?.access_token){
        await fetch(`${supabaseUrl}/auth/v1/logout`,{
          method:"POST",headers:{apikey:anonKey,Authorization:`Bearer ${session.access_token}`},
        });
      }
    }catch(_){}
    showLogin("");
  }

  async function bootAuthenticated(){
    showOwner();
    installOwnerUi();
    bindGlobalActionsOnce();
    window.MangoDashboard?.start?.();
    loadPrivateData();
    refreshResearch(true);
    scheduleRefresh();
  }

  let actionsBound=false;
  function bindGlobalActionsOnce(){
    if(actionsBound)return;
    actionsBound=true;
    bindGlobalActions();
  }

  async function boot(){
    window.MangoOwner={isActive:false,chainHeader,chainCell};
    $("ownerLoginForm").addEventListener("submit",login);
    if(!anonKey){showLogin("Owner 登录配置尚未完成。");return}
    session=readStoredSession();
    if(!session){showLogin();return}
    try{
      await ensureSession();
      await bootAuthenticated();
    }catch(_){showLogin("登录已失效，请重新登录。")}
  }

  boot();
})();
