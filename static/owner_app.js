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
  let otpEmail="";
  let otpResendAt=0;
  let otpResendTimer=null;
  let lastResearchAt=0;
  let researchLoading=false;
  let researchError=null;
  let privateLoadVersion=0;
  let stateSaveVersion=0;
  let stateSaveQueue=Promise.resolve();
  let positionFilter="all";
  const expandedPositionIds=new Set();
  let noticeMessage="";
  let noticeKind="";
  let noticeTimer=null;

  const $=id=>document.getElementById(id);
  const money=(value,decimals=0)=>{
    if(value===null||value===undefined||value==="")return "—";
    const number=Number(value);
    return Number.isFinite(number)
      ?`$${number.toLocaleString("en-US",{minimumFractionDigits:decimals,maximumFractionDigits:decimals})}`
      :"—";
  };
  const pct=(value,decimals=1)=>{
    if(value===null||value===undefined||value==="")return "—";
    const number=Number(value);
    return Number.isFinite(number)?`${number.toFixed(decimals)}%`:"—";
  };
  const days=value=>{
    if(value===null||value===undefined||value==="")return "—";
    const number=Number(value);
    return Number.isFinite(number)?`${Math.max(0,number).toFixed(0)} 天`:"—";
  };
  const signedPct=(value,decimals=1)=>{
    if(value===null||value===undefined||value==="")return "不可用";
    const number=Number(value);
    if(!Number.isFinite(number))return "不可用";
    return `${number>0?"+":""}${number.toFixed(decimals)}%`;
  };
  const signedPp=(value,decimals=1)=>{
    if(value===null||value===undefined||value==="")return "不可用";
    const number=Number(value);
    if(!Number.isFinite(number))return "不可用";
    return `${number>0?"+":""}${number.toFixed(decimals)} pp`;
  };
  const signedMoney=(value,decimals=0)=>{
    if(value===null||value===undefined||value==="")return "不可用";
    const number=Number(value);
    if(!Number.isFinite(number))return "不可用";
    const sign=number>0?"+":number<0?"-":"±";
    return `${sign}$${Math.abs(number).toLocaleString("en-US",{
      minimumFractionDigits:decimals,maximumFractionDigits:decimals,
    })}`;
  };
  const quoteTime=value=>{
    if(value===null||value===undefined||value==="")return "无成功报价";
    const timestamp=Number(value);
    if(!Number.isFinite(timestamp))return "无成功报价";
    return new Intl.DateTimeFormat("zh-CN",{
      month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
      hour12:false,timeZone:"UTC",
    }).format(new Date(timestamp))+" UTC";
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

  async function authRequest(path,body,{method="POST",token=""}={}){
    if(!anonKey)throw new Error("Owner 登录配置尚未完成");
    const headers={apikey:anonKey};
    if(body!==undefined)headers["content-type"]="application/json";
    if(token)headers.Authorization=`Bearer ${token}`;
    const response=await fetch(`${supabaseUrl}/auth/v1/${path}`,{
      method,
      cache:"no-store",
      headers,
      body:body===undefined?undefined:JSON.stringify(body),
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
    researchError=null;
    researchLoading=false;
    expandedPositionIds.clear();
    positionFilter="all";
    positions=[];
    ownerState={
      owner_id:null,stablecoin_usd:0,buy_band_low:null,buy_band_high:null,
      cash_floor_usd:null,updated_at:null,
    };
    window.MangoOwner.isActive=false;
    otpEmail="";
    otpResendAt=0;
    clearInterval(otpResendTimer);
    otpResendTimer=null;
    document.documentElement.classList.remove("owner-authenticated");
    document.documentElement.classList.remove("owner-pending");
    const dialog=$("ownerPositionDialog");
    if(dialog?.open){
      if(dialog.close)dialog.close();
      else dialog.removeAttribute("open");
    }
    const accountDialog=$("ownerAccountDialog");
    if(accountDialog?.open){
      if(accountDialog.close)accountDialog.close();
      else accountDialog.removeAttribute("open");
    }
    $("ownerLoginForm").hidden=false;
    $("ownerOtpForm").hidden=true;
    $("ownerOtpCode").value="";
    $("ownerOtpEmail").textContent="";
    $("ownerOtpError").classList.remove("ok");
    $("ownerOtpError").textContent="";
    $("ownerLoginError").classList.remove("ok");
    $("ownerLoginError").textContent=message;
    $("ownerLoginEmail").focus();
  }

  function updateOtpCooldown(){
    const button=$("ownerOtpResend");
    const seconds=Math.max(0,Math.ceil((otpResendAt-Date.now())/1000));
    button.disabled=seconds>0;
    button.textContent=seconds>0?`${seconds} 秒后可重发`:"重新发送";
    if(!seconds){
      clearInterval(otpResendTimer);
      otpResendTimer=null;
    }
  }

  function startOtpCooldown(){
    clearInterval(otpResendTimer);
    otpResendAt=Date.now()+60000;
    updateOtpCooldown();
    otpResendTimer=setInterval(updateOtpCooldown,1000);
  }

  function showOtpForm(email){
    clearInterval(refreshTimer);
    refreshTimer=null;
    refreshController?.abort();
    window.MangoOwner.isActive=false;
    document.documentElement.classList.remove("owner-authenticated");
    document.documentElement.classList.remove("owner-pending");
    $("ownerLoginForm").hidden=true;
    $("ownerOtpForm").hidden=false;
    otpEmail=email;
    $("ownerOtpEmail").textContent=email;
    $("ownerOtpCode").value="";
    $("ownerOtpError").classList.remove("ok");
    $("ownerOtpError").textContent="";
    startOtpCooldown();
    $("ownerOtpCode").focus();
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
    if(!$("ownerAccountDialog")){
      document.body.insertAdjacentHTML("beforeend",accountDialogHtml());
      bindAccountDialog();
    }
    renderAccount();
    renderPositions();
  }

  function accountHtml(){
    const account=Strategy.portfolioSummary(ownerState,positions,research);
    const capital=Strategy.deribitCapitalSummary(positions,research);
    const stale=!Strategy.sourceUsable(research);
    const asof=research?.source_status?.chain_asof_epoch_ms;
    const decisions=Strategy.positionRows(ownerState,positions,research);
    const attention=decisions.filter(row=>row.decision.state!=="not_due").length;
    const quoteLabel=researchError?"刷新失败":stale?"报价不可用":"最后成功";
    const pnlClass=account.pnl_complete&&account.unrealized_pnl_total>0
      ?"good":account.pnl_complete&&account.unrealized_pnl_total<0?"bad":"muted";
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
    return `<div class="owner-account-head"><div><span class="owner-kicker">PRIVATE PORTFOLIO</span><strong>BTC 期权账户</strong><small>完整经济资本口径</small></div><div class="owner-account-actions"><button type="button" id="ownerAccountSettings" class="owner-quiet">账户设置</button><button type="button" id="ownerRetry" class="owner-quiet"${researchLoading?" disabled":""}>${researchLoading?"刷新中…":"刷新报价"}</button><button type="button" id="ownerLogout" class="owner-quiet">退出</button></div></div>
      <div class="owner-account-grid" aria-label="账户与持仓汇总">
        <div class="owner-account-metric owner-account-hero ${account.available<0?"bad":""}"><span>可用资本</span><strong>${money(account.available)}</strong><small>稳定币扣除 K×Q 承诺</small></div>
        <div class="owner-account-metric owner-account-hero ${pnlClass}"><span>总未实现 P&amp;L</span><strong>${account.pnl_complete?signedMoney(account.unrealized_pnl_total):"不可用"}</strong>${account.quote_unavailable_count?`<small>${account.quote_unavailable_count} 笔 Ask 缺失或过期</small>`:"<small>按当前 Ask 平仓估算</small>"}</div>
        <div class="owner-account-metric"><span>完整承诺</span><strong>${money(account.put_reserved)}</strong><small>K×Q 经济资本</small></div>
        <div class="owner-account-metric ${account.pnl_complete?"":"muted"}"><span>Ask 平仓成本</span><strong>${account.pnl_complete?money(account.close_cost_total):"不可用"}</strong><small>不使用 Bid 或 Mark 替代</small></div>
        <div class="owner-account-metric ${attention?"warn":""}"><span>需处理</span><strong>${attention}<em> / ${positions.length}</em></strong><small>${attention?"按风险优先排序":"当前无待复核仓位"}</small></div>
      </div>
      <div class="owner-account-meta"><span>稳定币 <strong>${money(ownerState.stablecoin_usd)}</strong></span><span>开仓权利金 <strong>${money(account.open_premium_total)}</strong></span><span class="${stale||researchError?"warn":""}">${quoteLabel} <strong>${quoteTime(asof)}</strong></span></div>
      <details class="owner-capital"><summary><span>保证金与生息准备金</span><span>默认折叠 · 研究估算</span></summary>${capitalBody}</details>
      <div class="owner-private-error" id="ownerPrivateError"${privateError||researchError?"":" hidden"}>${privateError?`${esc(privateError)} <button type="button" data-owner-retry>重试私有数据</button>`:researchError?`${esc(researchError)} <button type="button" data-owner-quote-retry>重试报价</button>`:""}</div>`;
  }

  function renderAccount(){
    const node=$("ownerAccountBar");
    if(!node)return;
    node.innerHTML=accountHtml();
    $("ownerLogout").addEventListener("click",logout);
    $("ownerRetry").addEventListener("click",refreshAll);
    $("ownerAccountSettings").addEventListener("click",openAccountDialog);
    node.querySelector("[data-owner-retry]")?.addEventListener("click",loadPrivateData);
    node.querySelector("[data-owner-quote-retry]")?.addEventListener("click",()=>refreshResearch(true));
  }

  function accountDialogHtml(){
    return `<dialog id="ownerAccountDialog" class="owner-dialog" role="dialog" aria-modal="true" aria-labelledby="ownerAccountDialogTitle"><form id="ownerAccountForm" method="dialog"><div class="owner-dialog-head"><div><span class="owner-kicker">ACCOUNT</span><h2 id="ownerAccountDialogTitle">账户设置</h2></div><button type="button" class="owner-dialog-close" id="ownerAccountClose" aria-label="关闭">×</button></div><div class="owner-form-grid">
      <label><span>稳定币 USD</span><input id="ownerStablecoin" type="number" min="0" step="any" inputmode="decimal" required></label>
      <label><span>现金底线</span><input id="ownerCashFloor" type="number" min="0" step="any" inputmode="decimal" placeholder="未配置"></label>
      <label><span>买入带下沿</span><input id="ownerBandLow" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="未配置"></label>
      <label><span>买入带上沿</span><input id="ownerBandHigh" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="未配置"></label>
    </div><p class="owner-form-note">稳定币与 K×Q 完整承诺共同决定可用资本。</p><div class="owner-dialog-error" id="ownerAccountError" role="alert"></div><div class="owner-dialog-actions"><button type="button" class="owner-quiet" id="ownerAccountCancel">取消</button><button type="submit" class="owner-primary" id="ownerAccountSave">保存设置</button></div></form></dialog>`;
  }

  function bindAccountDialog(){
    $("ownerAccountClose").addEventListener("click",()=>closeAccountDialog({discard:true}));
    $("ownerAccountCancel").addEventListener("click",()=>closeAccountDialog({discard:true}));
    $("ownerAccountDialog").addEventListener("cancel",event=>{
      event.preventDefault();
      closeAccountDialog({discard:true});
    });
    $("ownerAccountForm").addEventListener("submit",event=>{
      event.preventDefault();
      saveOwnerState();
    });
    $("ownerAccountForm").addEventListener("input",()=>{
      localStorage.setItem(ACCOUNT_DRAFT_KEY,JSON.stringify(accountDraftFromInputs()));
    });
  }

  function openAccountDialog(){
    if(!privateReady){setNotice("私有数据尚未就绪，请稍后重试。","bad");return}
    const draft=readStoredJson(ACCOUNT_DRAFT_KEY)||ownerState;
    $("ownerStablecoin").value=inputValue(draft.stablecoin_usd);
    $("ownerBandLow").value=inputValue(draft.buy_band_low);
    $("ownerBandHigh").value=inputValue(draft.buy_band_high);
    $("ownerCashFloor").value=inputValue(draft.cash_floor_usd);
    $("ownerAccountError").textContent="";
    const dialog=$("ownerAccountDialog");
    if(dialog.showModal)dialog.showModal();
    else dialog.setAttribute("open","");
    $("ownerStablecoin").focus();
  }

  function closeAccountDialog({discard=false}={}){
    if(discard)localStorage.removeItem(ACCOUNT_DRAFT_KEY);
    const dialog=$("ownerAccountDialog");
    if(dialog.close)dialog.close();
    else dialog.removeAttribute("open");
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

  function saveOwnerState(){
    clearTimeout(saveTimer);
    if(!privateReady)return Promise.resolve();
    const button=$("ownerAccountSave");
    const status=$("ownerAccountError");
    const draft=accountDraftFromInputs();
    const sessionOwnerId=session?.user?.id;
    const version=++stateSaveVersion;
    status.textContent="";
    button.disabled=true;
    button.textContent="保存中…";
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
      closeAccountDialog({discard:false});
      renderAccount();
      renderPositions();
      renderEntry();
      setNotice("账户设置已保存。","ok");
    }).catch(error=>{
      if(version!==stateSaveVersion)return;
      status.textContent=error.message;
    }).finally(()=>{
      if(button.isConnected){button.disabled=false;button.textContent="保存设置"}
    });
    return stateSaveQueue;
  }

  function setNotice(message,kind="ok"){
    noticeMessage=message;
    noticeKind=kind;
    clearTimeout(noticeTimer);
    const node=$("ownerNotice");
    if(node){node.className=`owner-notice ${kind}`;node.textContent=message;node.hidden=false}
    noticeTimer=setTimeout(()=>{
      noticeMessage="";
      const current=$("ownerNotice");
      if(current)current.hidden=true;
    },4200);
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

  function quoteUnavailableReason(metrics){
    if(!metrics.quote)return "当前期权链没有匹配合约";
    if(!Strategy.sourceUsable(research))return "报价超过 120 秒或上游不可用";
    if(metrics.current_ask===null)return "当前 Ask 缺失";
    return "";
  }

  function progressAxis(metrics){
    const clamp=value=>Math.min(100,Math.max(0,Number(value)||0));
    const captureAvailable=metrics.capture_pct!==null;
    const capturePosition=captureAvailable?clamp(metrics.capture_pct):0;
    const captureClass=!captureAvailable?"muted":metrics.capture_pct<0?"bad":"premium";
    const elapsedPosition=clamp(metrics.time_elapsed_pct);
    return `<section class="owner-progress-axis" aria-label="权利金与时间进度">
      <div class="owner-axis-head"><div><span class="owner-kicker">POSITION PROGRESS</span><strong>权利金 / 时间轴</strong></div><small>策略线：赚 70% / 耗时 25%</small></div>
      <div class="owner-axis-scale" aria-hidden="true"><div class="owner-axis-ticks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div>
      <div class="owner-axis-row ${captureClass}"><span class="owner-axis-label">权利金已赚</span><div class="owner-axis-track"><span class="owner-axis-fill" style="--axis-pct:${capturePosition.toFixed(2)}%"></span><i class="owner-axis-threshold" style="--axis-pct:70%" aria-hidden="true"></i><i class="owner-axis-marker${captureAvailable?"":" unavailable"}" style="--axis-pct:${capturePosition.toFixed(2)}%"></i></div><strong>${captureAvailable?signedPct(metrics.capture_pct):"不可用"}</strong></div>
      <div class="owner-axis-row time"><span class="owner-axis-label">时间已走<small>开仓时 ${days(metrics.open_dte)}</small></span><div class="owner-axis-track"><span class="owner-axis-fill" style="--axis-pct:${elapsedPosition.toFixed(2)}%"></span><i class="owner-axis-threshold" style="--axis-pct:25%" aria-hidden="true"></i><i class="owner-axis-marker" style="--axis-pct:${elapsedPosition.toFixed(2)}%"></i></div><strong>${pct(metrics.time_elapsed_pct)}<small>现在剩 ${days(metrics.dte)}</small></strong></div>
    </section>`;
  }

  function metricTip(label,copy){
    return `<span class="tip" tabindex="0">${label}<span class="tt">${copy}</span></span>`;
  }

  function economicsLedger(metrics){
    const usable=metrics.quote_usable&&metrics.remaining_apr!==null;
    const netClass=!usable?"muted":metrics.remaining_max_net_value<0?"bad":"good";
    const bufferClass=!usable?"muted":metrics.remaining_apr_buffer_pp<0?"bad":"good";
    return `<section class="owner-economics-ledger" aria-label="持仓经济性">
      <div class="owner-economics-head"><span class="owner-kicker">HOLD ECONOMICS</span><strong>从今天继续持有</strong><small>条件上界，不是收益预测</small></div>
      <div class="owner-economics-grid">
        <div class="${netClass}"><span>${metricTip("扣 8% 门槛后上界","当前 Ask 代表剩余权利金价值，再扣完整 K×Q 资本在剩余 DTE 对应的 8% 策略门槛复利金额。未扣未来滑点与场所风险。")}</span><strong>${usable?signedMoney(metrics.remaining_max_net_value,2):"不可用"}</strong><small>条件年化 ${usable?signedPct(metrics.remaining_max_net_apr):"不可用"}</small></div>
        <div class="${bufferClass}"><span>${metricTip("10% 退出线余量","当前规则用 8% 策略门槛加 2 个百分点缓冲。余量小于 0 时触发资本效率复核。")}</span><strong>${usable?signedPp(metrics.remaining_apr_buffer_pp):"不可用"}</strong><small>剩余条件年化 − ${pct(metrics.exit_apr_threshold,0)}</small></div>
        <div><span>${metricTip("等效损益平衡价","Strike 减开仓权利金。Deribit 为 USDC 现金结算，这只是损益记账参考，不代表自动接收 BTC。")}</span><strong>${money(metrics.effective_breakeven_price,2)}</strong><small>每 1 BTC 名义</small></div>
        <div><span>${metricTip("完整资本 / 最大净损失","容量分母始终按 K×Q。最大净损失是假设 BTC 归零并扣除开仓权利金，未计额外费用。")}</span><strong>${money(metrics.capacity_capital,2)}</strong><small>归零路径 ${money(metrics.maximum_net_loss,2)}</small></div>
      </div>
      <p>剩余条件年化以当前顶档 Ask、完整 K×Q 与剩余 DTE 简单年化；它是到期归零时的上界，不是预期 APY。资本效率只回答是否值得继续占用资本；承诺缺口、触及 Strike 与报价失效仍按风险优先。</p>
    </section>`;
  }

  function positionDetail(row){
    const {position:positionValue,decision,metrics}=row;
    const unavailable=quoteUnavailableReason(metrics);
    const spread=metrics.spread_pct===null?"—":pct(metrics.spread_pct);
    const quoteState=metrics.quote_usable?"可用":unavailable||"不可用";
    const pnlClass=metrics.quote_usable&&metrics.unrealized_pnl>0
      ?"good":metrics.quote_usable&&metrics.unrealized_pnl<0?"bad":"muted";
    return `<div class="owner-position-detail">
      <div class="owner-inspector-head"><div><span class="owner-kicker">SELECTED POSITION</span><h3>BTC ${money(positionValue.strike)} Put</h3><p>${esc(positionValue.expiry)} · ${positionValue.notional_btc.toLocaleString()} BTC</p></div><span class="owner-status ${statusClass(decision.state)}">${esc(decision.verdict)}</span></div>
      <div class="owner-inspector-hero">
        <div class="${pnlClass}"><span>未实现 P&amp;L</span><strong>${metrics.quote_usable?signedMoney(metrics.unrealized_pnl,2):"不可用"}</strong><small>${metrics.quote_usable?`已捕获 ${signedPct(metrics.capture_pct)}`:esc(unavailable)}</small></div>
        <div><span>${metricTip("Ask 平仓 / 剩余价值","按当前顶档 Ask 买回的估算成本；若期权最终归零，它也是从今天起最多还能赚到的毛权利金。")}</span><strong>${metrics.quote_usable?money(metrics.close_cost,2):"不可用"}</strong><small>Ask ${money(metrics.current_ask,2)} / BTC · 剩余条件年化 ${pct(metrics.remaining_apr)}</small></div>
        <div><span>剩余期限</span><strong>${metrics.dte.toFixed(0)} DTE</strong><small>距 Strike ${signedPct(metrics.strike_distance_pct)}</small></div>
      </div>
      ${progressAxis(metrics)}
      ${economicsLedger(metrics)}
      <div class="owner-inspector-reason ${statusClass(decision.state)}"><span>复核结论</span><strong>${esc(decision.verdict)}</strong><p>${esc(decision.reason)}</p></div>
      <div class="owner-detail-grid">
        <div><span>开仓日期</span><strong>${esc(positionValue.open_date)}</strong></div>
        <div><span>开仓权利金</span><strong>${money(positionValue.open_premium_per_btc,2)} / BTC</strong><small>合计 ${money(metrics.open_premium_total,2)}</small></div>
        <div><span>Bid</span><strong>${money(metrics.current_bid,2)}</strong></div>
        <div><span>Ask · 平仓依据</span><strong>${money(metrics.current_ask,2)}</strong></div>
        <div><span>Mark</span><strong>${money(metrics.current_mark,2)}</strong></div>
        <div><span>Spread</span><strong>${spread}</strong></div>
        <div><span>IV</span><strong>${pct(metrics.iv)}</strong></div>
        <div><span>Delta</span><strong>${metrics.delta===null?"—":Number(metrics.delta).toFixed(3)}</strong></div>
        <div><span>现价距 Strike</span><strong>${signedPct(metrics.strike_distance_pct)}</strong></div>
        <div><span>报价时间</span><strong>${quoteTime(metrics.quote_asof_epoch_ms)}</strong></div>
        <div class="${metrics.quote_usable?"good":"bad"}"><span>报价状态</span><strong>${esc(quoteState)}</strong></div>
      </div>
      ${unavailable?`<p class="owner-quote-warning">${esc(unavailable)}：未实现 P&amp;L、捕获率和基于报价的平仓结论已禁用；用户录入的持仓仍保留。</p>`:""}
      <div class="owner-secondary-actions"><button type="button" class="owner-quiet" data-owner-edit="${esc(positionValue.id)}"${privateReady?"":" disabled"}>编辑持仓</button><button type="button" class="owner-quiet bad" data-owner-delete="${esc(positionValue.id)}"${privateReady?"":" disabled"}>删除持仓</button></div>
      <details class="owner-research-card"><summary><span>高级研究 / CVaR / 压力测试</span><span>默认折叠</span></summary>${researchCard(positionValue)}</details>
    </div>`;
  }

  function positionRow(row){
    const {position:positionValue,decision,metrics}=row;
    const expired=Strategy.isExpired(positionValue);
    const expanded=expandedPositionIds.has(positionValue.id);
    const pnlClass=metrics.quote_usable&&metrics.unrealized_pnl>0
      ?"good":metrics.quote_usable&&metrics.unrealized_pnl<0?"bad":"muted";
    return `<button type="button" class="owner-position-item ${expanded?"selected":""} ${expired?"owner-expired":""}" data-owner-toggle="${esc(positionValue.id)}" aria-pressed="${expanded}">
      <span class="owner-position-contract"><strong>BTC ${money(positionValue.strike)} Put</strong><small>${esc(positionValue.expiry)} · ${positionValue.notional_btc.toLocaleString()} BTC</small></span>
      <span class="owner-position-pnl ${pnlClass}"><strong>${metrics.quote_usable?signedMoney(metrics.unrealized_pnl,2):"不可用"}</strong><small>${metrics.quote_usable?`捕获 ${signedPct(metrics.capture_pct)}`:esc(quoteUnavailableReason(metrics))}</small></span>
      <span class="owner-position-dte"><strong>${metrics.dte.toFixed(0)} DTE</strong><small>距 Strike ${signedPct(metrics.strike_distance_pct)}</small></span>
      <span class="owner-position-state ${statusClass(decision.state)}"><i></i><strong>${esc(decision.verdict)}</strong></span>
    </button>`;
  }

  function renderPositions(){
    const page=$("ownerPositionsPage");
    if(!page)return;
    if(!positionsRoute){page.hidden=true;return}
    page.hidden=false;
    const entryCard=$("ownerEntryCard");
    const allRows=Strategy.positionRows(ownerState,positions,research);
    const attentionCount=allRows.filter(row=>row.decision.state!=="not_due").length;
    const normalCount=allRows.length-attentionCount;
    const visibleRows=Strategy.positionRows(ownerState,positions,research,Date.now(),positionFilter);
    const emptyCopy=!positions.length
      ?"还没有持仓。可以从 Sell Put 行情页加入，或手动录入。"
      :positionFilter==="attention"?"当前没有需处理仓位。":"当前没有正常仓位。";
    let selectedRow=visibleRows.find(row=>expandedPositionIds.has(row.position.id))||visibleRows[0]||null;
    if(selectedRow){expandedPositionIds.clear();expandedPositionIds.add(selectedRow.position.id)}
    const rows=visibleRows.length?visibleRows.map(positionRow).join(""):
      `<div class="owner-empty">${emptyCopy}</div>`;
    page.innerHTML=`<div class="owner-page-head"><div><span class="owner-kicker">POSITIONS</span><h2>Sell Put 持仓工作台</h2><p>选择一笔仓位，在同一屏完成行情、盈亏与风险复核。</p></div><button type="button" class="owner-primary" id="ownerManualAdd"${privateReady?"":" disabled"}>＋ 新增持仓</button></div>
      <div class="owner-notice ${esc(noticeKind)}" id="ownerNotice" role="status"${noticeMessage?"":" hidden"}>${esc(noticeMessage)}</div>
      ${privateReady?"":`<div class="owner-private-error">${esc(privateError||"私有数据正在加载，编辑暂停。")}</div>`}
      <div class="owner-entry-slot"></div>
      <div class="owner-workspace"><section class="owner-list-panel" aria-label="持仓列表"><div class="owner-position-toolbar" role="group" aria-label="持仓过滤"><button type="button" data-owner-filter="all" aria-pressed="${positionFilter==="all"}">全部 <strong>${allRows.length}</strong></button><button type="button" data-owner-filter="attention" aria-pressed="${positionFilter==="attention"}">需处理 <strong>${attentionCount}</strong></button><button type="button" data-owner-filter="normal" aria-pressed="${positionFilter==="normal"}">正常 <strong>${normalCount}</strong></button></div><div class="owner-position-list">${rows}</div></section><aside class="owner-position-inspector" aria-label="持仓详情">${selectedRow?positionDetail(selectedRow):`<div class="owner-empty">选择一笔持仓查看详情。</div>`}</aside></div>`;
    if(entryCard)page.querySelector(".owner-entry-slot").appendChild(entryCard);
    $("ownerManualAdd")?.addEventListener("click",()=>openPositionDialog());
    page.querySelectorAll("[data-owner-filter]").forEach(button=>button.addEventListener("click",()=>{
      positionFilter=button.dataset.ownerFilter;
      renderPositions();
    }));
    page.querySelectorAll("[data-owner-toggle]").forEach(button=>button.addEventListener("click",()=>{
      const id=button.dataset.ownerToggle;
      expandedPositionIds.clear();
      expandedPositionIds.add(id);
      renderPositions();
      page.querySelector(`[data-owner-toggle="${CSS.escape(id)}"]`)?.focus();
    }));
    page.querySelectorAll("[data-owner-edit]").forEach(button=>button.addEventListener("click",()=>{
      openPositionDialog(positions.find(row=>row.id===button.dataset.ownerEdit));
    }));
    page.querySelectorAll("[data-owner-delete]").forEach(button=>button.addEventListener("click",()=>deletePosition(button.dataset.ownerDelete)));
  }

  function positionDialogHtml(){
    return `<dialog id="ownerPositionDialog" class="owner-dialog" role="dialog" aria-modal="true" aria-labelledby="ownerDialogTitle"><form id="ownerPositionForm" method="dialog"><div class="owner-dialog-head"><div><span class="owner-kicker">SELL PUT LEDGER</span><h2 id="ownerDialogTitle">加入持仓</h2></div><button type="button" class="owner-dialog-close" id="ownerDialogClose" aria-label="关闭">×</button></div><input type="hidden" id="ownerPositionId"><div class="owner-form-grid">
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
      setNotice(id?"持仓已更新。":"持仓已加入。","ok");
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
      expandedPositionIds.delete(id);
      await loadPrivateData();
      setNotice("持仓已删除。","ok");
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
    if(researchLoading)return;
    researchLoading=true;
    researchError=null;
    renderAccount();
    const version=++refreshVersion;
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
    }catch(error){
      if(error.name==="AbortError"||version!==refreshVersion)return;
      researchError="报价刷新失败；旧报价已停止用于损益和平仓结论。";
      if(research){
        research={...research,source_status:{
          ...(research.source_status||{}),chain_stale:true,
        }};
      }
      setNotice("报价刷新失败，可重试。","bad");
    }finally{
      if(version!==refreshVersion)return;
      researchLoading=false;
      renderAccount();
      renderPositions();
      renderEntry();
      window.MangoDashboard?.rerender?.();
    }
  }

  function refreshAll(){
    if(researchLoading)return;
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

  async function sendOtp(event){
    event.preventDefault();
    const emailInput=$("ownerLoginEmail");
    if(!emailInput.reportValidity())return;
    const button=$("ownerLoginSubmit");
    const errorNode=$("ownerLoginError");
    errorNode.classList.remove("ok");
    errorNode.textContent="";
    button.disabled=true;
    button.textContent="发送中…";
    try{
      const email=emailInput.value.trim();
      await authRequest("otp",{email,create_user:false});
      showOtpForm(email);
    }catch(error){errorNode.textContent=error.message}
    finally{button.disabled=false;button.textContent="发送验证码"}
  }

  async function resendOtp(){
    if(!otpEmail||Date.now()<otpResendAt)return;
    const button=$("ownerOtpResend");
    const message=$("ownerOtpError");
    message.classList.remove("ok");
    message.textContent="";
    button.disabled=true;
    button.textContent="发送中…";
    try{
      await authRequest("otp",{email:otpEmail,create_user:false});
      message.classList.add("ok");
      message.textContent="新验证码已发送。";
      startOtpCooldown();
    }catch(error){message.textContent=error.message}
    finally{if(Date.now()>=otpResendAt){button.disabled=false;button.textContent="重新发送"}}
  }

  async function verifyOtp(event){
    event.preventDefault();
    const token=$("ownerOtpCode").value.trim();
    const button=$("ownerOtpSubmit");
    const errorNode=$("ownerOtpError");
    errorNode.classList.remove("ok");
    errorNode.textContent="";
    if(!/^\d{6}$/.test(token)){errorNode.textContent="请输入邮件中的 6 位验证码。";return}
    button.disabled=true;
    button.textContent="验证中…";
    try{
      const payload=await authRequest("verify",{email:otpEmail,token,type:"email"});
      persistSession(normalizeAuthPayload(payload));
      $("ownerOtpCode").value="";
      await bootAuthenticated();
    }catch(error){errorNode.textContent=error.message}
    finally{button.disabled=false;button.textContent="验证并登录"}
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
    $("ownerLoginForm").addEventListener("submit",sendOtp);
    $("ownerOtpForm").addEventListener("submit",verifyOtp);
    $("ownerOtpResend").addEventListener("click",resendOtp);
    $("ownerOtpBack").addEventListener("click",()=>showLogin());
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
