(function(){
  "use strict";

  const pathname=window.location.pathname;
  const marker="/owner";
  const markerIndex=pathname.indexOf(marker);
  const topStockMatch=pathname.match(/^(.*)\/(us-options|us-rankings)\/?$/);
  if(markerIndex<0&&!topStockMatch)return;
  document.documentElement.classList.add("owner-route");

  const Strategy=window.OwnerStrategy;
  if(!Strategy)throw new Error("OwnerStrategy is required");
  const projectBase=markerIndex>=0
    ?pathname.slice(0,markerIndex)
    :String(topStockMatch?.[1]||"");
  const ownerBase=`${projectBase}/owner/`;
  const stockBase=`${projectBase}/us-options/`;
  const ownerSuffix=markerIndex>=0
    ?pathname.slice(markerIndex+marker.length).replace(/^\/+|\/+$/g,"")
    :String(topStockMatch?.[2]||"");
  const positionsRoute=ownerSuffix==="";
  const stockRoute=ownerSuffix==="us-options"||ownerSuffix==="us-rankings";
  const rankingsRoute=ownerSuffix==="us-candidates";
  const SESSION_KEY="mango.owner.session.v1";
  const AUTH_REFRESH_LOCK="mango.owner.session-refresh.v1";
  const AUTH_REFRESH_EARLY_MS=60000;
  const AUTH_RETRY_BASE_MS=15000;
  const AUTH_RETRY_MAX_MS=300000;
  const DRAFT_KEY="mango.owner.position-draft.v1";
  const CLOSED_DRAFT_KEY="mango.owner.closed-position-draft.v1";
  const ACCOUNT_DRAFT_KEY="mango.owner.account-draft.v1";
  const PROJECT_URL="https://yvpgdnbcjgxpjqenhvuo.supabase.co";
  const config=window.MANGO_OWNER_CONFIG||{};
  const supabaseUrl=String(config.url||PROJECT_URL).replace(/\/$/,"");
  const anonKey=String(config.anonKey||config.publishableKey||"").trim();
  const OWNER_ASSETS=["BTC","ETH","HYPE"];
  const ASSET_DEFAULTS={
    BTC:{notional:1,min:.01},ETH:{notional:1,min:.1},HYPE:{notional:10,min:10},
  };

  let session=null;
  let ownerState={
    owner_id:null,stablecoin_usd:0,buy_band_low:null,buy_band_high:null,
    cash_floor_usd:null,updated_at:null,
  };
  let positions=[];
  let closedPositions=[];
  let researchByAsset={};
  let privateReady=false;
  let privateError=null;
  let refreshController=null;
  let refreshVersion=0;
  let saveTimer=null;
  let refreshTimer=null;
  let authTimer=null;
  let authRefreshPromise=null;
  let authRetryAttempt=0;
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
  const stressRangeByPositionId=new Map();
  let noticeMessage="";
  let noticeKind="";
  let noticeTimer=null;
  let optionRankData=null;
  let optionRankLoading=false;
  let optionRankError="";
  let optionRankController=null;

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
  const utcDateTime=value=>{
    const timestamp=Date.parse(String(value||""));
    if(!Number.isFinite(timestamp))return "—";
    return new Intl.DateTimeFormat("zh-CN",{
      month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
      hour12:false,timeZone:"UTC",
    }).format(new Date(timestamp))+" UTC";
  };
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
  })[char]);
  const inputValue=value=>value==null?"":String(value);
  const currentMarketAsset=()=>{
    try{return Strategy.normalizeAsset(window.MangoDashboard?.getState?.()?.asset||"BTC")}
    catch(_){return "BTC"}
  };
  const researchFor=asset=>Strategy.researchForAsset(asset,researchByAsset);
  const heldAssets=()=>positions.length
    ?[...new Set(positions.map(position=>position.asset))]
    :OWNER_ASSETS;

  function readStoredJson(key){
    try{return JSON.parse(localStorage.getItem(key)||"null")}
    catch(_){return null}
  }

  function readStoredSession(){
    const value=readStoredJson(SESSION_KEY);
    if(!value?.access_token||!value?.refresh_token||!value?.user?.id)return null;
    return value;
  }

  function persistSession(value,{write=true}={}){
    session=value;
    authRetryAttempt=0;
    if(write){
      if(value)localStorage.setItem(SESSION_KEY,JSON.stringify(value));
      else localStorage.removeItem(SESSION_KEY);
    }
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
    if(!response.ok){
      const error=new Error(payload.error_description||payload.msg||payload.error||"登录失败");
      error.status=response.status;
      error.code=payload.error_code||payload.code||"";
      throw error;
    }
    return payload;
  }

  function authorizedFetch(input,init={}){
    if(!session?.access_token){
      return Promise.reject(new Error("Owner 登录已失效，请重新登录。"));
    }
    const headers=new Headers(init.headers||{});
    headers.set("apikey",anonKey);
    headers.set("Authorization",`Bearer ${session.access_token}`);
    headers.set("X-Mango-Owner-Request","1");
    return fetch(input,{...init,headers});
  }

  function isTerminalAuthError(error){
    const status=Number(error?.status);
    const code=String(error?.code||"").toLowerCase();
    return status===400||status===401||[
      "refresh_token_not_found","refresh_token_already_used",
      "session_not_found","session_expired","user_not_found",
    ].includes(code);
  }

  function adoptLatestStoredSession(){
    const stored=readStoredSession();
    if(!stored)return false;
    const sameUser=!session||stored.user.id===session.user.id;
    const newer=!session||stored.refresh_token!==session.refresh_token||
      Number(stored.expires_at)>Number(session.expires_at);
    if(!sameUser||!newer)return false;
    persistSession(stored,{write:false});
    return true;
  }

  async function refreshSessionUnlocked(force=false,requestedRefreshToken=""){
    adoptLatestStoredSession();
    if(!session?.refresh_token){
      const error=new Error("登录已失效");
      error.status=401;
      error.code="refresh_token_not_found";
      throw error;
    }
    if(force&&requestedRefreshToken&&session.refresh_token!==requestedRefreshToken)return session;
    if(!force&&Number(session.expires_at)*1000-Date.now()>=AUTH_REFRESH_EARLY_MS){
      scheduleAuthRefresh();
      return session;
    }
    const previousRefreshToken=session.refresh_token;
    const payload=await authRequest("token?grant_type=refresh_token",{
      refresh_token:previousRefreshToken,
    });
    const stored=readStoredSession();
    if(stored?.user?.id===payload.user?.id&&stored.refresh_token!==previousRefreshToken&&
      Number(stored.expires_at)>=Number(payload.expires_at||0)){
      persistSession(stored,{write:false});
      return session;
    }
    persistSession(normalizeAuthPayload(payload));
    return session;
  }

  function refreshSession({force=false}={}){
    if(authRefreshPromise)return authRefreshPromise;
    const requestedRefreshToken=session?.refresh_token||"";
    const refresh=()=>refreshSessionUnlocked(force,requestedRefreshToken);
    const coordinated=navigator.locks?.request
      ?navigator.locks.request(AUTH_REFRESH_LOCK,refresh)
      :refresh();
    authRefreshPromise=Promise.resolve(coordinated).finally(()=>{authRefreshPromise=null});
    return authRefreshPromise;
  }

  async function ensureSession(){
    adoptLatestStoredSession();
    if(!session){
      const error=new Error("请先登录");
      error.status=401;
      error.code="session_not_found";
      throw error;
    }
    if(Number(session.expires_at)*1000-Date.now()<AUTH_REFRESH_EARLY_MS){
      await refreshSession();
    }
    return session;
  }

  function scheduleAuthRefresh(delay=null){
    clearTimeout(authTimer);
    if(!session)return;
    const wait=delay===null
      ?Math.max(1000,Number(session.expires_at)*1000-Date.now()-AUTH_REFRESH_EARLY_MS)
      :delay;
    authTimer=setTimeout(runScheduledAuthRefresh,wait);
  }

  function scheduleAuthRetry(error){
    if(isTerminalAuthError(error)){
      if(adoptLatestStoredSession()){
        scheduleAuthRefresh(0);
        return;
      }
      showLogin("登录已失效，请重新验证邮箱。");
      return;
    }
    authRetryAttempt++;
    const delay=Math.min(AUTH_RETRY_MAX_MS,AUTH_RETRY_BASE_MS*2**(authRetryAttempt-1));
    if(!window.MangoOwner?.isActive){
      showLogin("正在自动恢复上次登录，无需重新收验证码。",{clearSession:false});
    }
    scheduleAuthRefresh(delay);
  }

  async function runScheduledAuthRefresh(){
    try{
      await refreshSession();
      if(!window.MangoOwner?.isActive)await bootAuthenticated();
    }catch(error){scheduleAuthRetry(error)}
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
      try{await refreshSession({force:true})}
      catch(error){
        if(!isTerminalAuthError(error)){
          scheduleAuthRetry(error);
          throw error;
        }
        const expiredError=new Error("登录已失效");
        expiredError.status=401;
        expiredError.code="session_expired";
        throw expiredError;
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

  function showLogin(message="",{clearSession=true}={}){
    privateLoadVersion++;
    stateSaveVersion++;
    clearInterval(refreshTimer);
    refreshTimer=null;
    refreshController?.abort();
    if(clearSession)persistSession(null);
    privateReady=false;
    privateError=null;
    researchByAsset={};
    researchError=null;
    researchLoading=false;
    expandedPositionIds.clear();
    positionFilter="all";
    positions=[];
    closedPositions=[];
    optionRankData=null;
    optionRankLoading=false;
    optionRankError="";
    optionRankController?.abort();
    optionRankController=null;
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
    const closedDialog=$("ownerClosedDialog");
    if(closedDialog?.open){
      if(closedDialog.close)closedDialog.close();
      else closedDialog.removeAttribute("open");
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
    document.documentElement.classList.toggle("owner-stock-route",stockRoute);
    document.documentElement.classList.toggle("owner-rankings-route",rankingsRoute);
    document.documentElement.classList.remove("owner-pending");
    window.MangoOwner.isActive=true;
  }

  function handleSessionStorage(event){
    if(event.key!==SESSION_KEY)return;
    const stored=readStoredSession();
    if(!stored){
      if(session)showLogin("登录已在其他标签页退出。",{clearSession:false});
      return;
    }
    const changed=!session||stored.refresh_token!==session.refresh_token||
      Number(stored.expires_at)!==Number(session.expires_at);
    if(!changed)return;
    persistSession(stored,{write:false});
    if(!window.MangoOwner?.isActive)scheduleAuthRefresh(0);
  }

  function configureNavigation(){
    $("cryptoMarketNav").href=`${projectBase}/options/`;
    $("sellPutNav").href=`${ownerBase}options/`;
    $("buyCallNav").href=`${ownerBase}buy-call/`;
    $("coveredCallNav").href=`${ownerBase}covered-call/`;
    const headerRight=$("cryptoMarketNav").closest(".right");
    if(!$("ownerPositionsNav")){
      const link=document.createElement("a");
      link.id="ownerPositionsNav";
      link.href=ownerBase;
      link.textContent="持仓";
      link.className="utility-nav";
      headerRight.insertBefore(link,$("ts"));
    }
    $("usOptionsNav").href=stockBase;
    if(positionsRoute){
      $("sellPutNav").classList.remove("on");
      $("buyCallNav").classList.remove("on");
      $("coveredCallNav").classList.remove("on");
      $("ownerPositionsNav").classList.add("on");
      $("ownerPositionsNav").setAttribute("aria-current","page");
      $("cryptoMarketNav").classList.add("on");
      $("pageTitle").textContent="Sell Put · 持仓";
      document.title="Sell Put Owner";
    }
    if(stockRoute){
      const ticker=String(new URLSearchParams(window.location.search).get("ticker")||"")
        .trim().toUpperCase();
      const tickerQuery=ticker?`&ticker=${encodeURIComponent(ticker)}`:"";
      $("sellPutNav").href=`${stockBase}${ticker?`?ticker=${encodeURIComponent(ticker)}`:""}`;
      $("buyCallNav").href=`${stockBase}?strategy=buy_call${tickerQuery}`;
      $("coveredCallNav").href=`${stockBase}?strategy=covered_call${tickerQuery}`;
      $("ownerPositionsNav").classList.remove("on");
      $("cryptoMarketNav").classList.remove("on");
      $("usOptionsNav").classList.add("on");
      $("usOptionsNav").setAttribute("aria-current","page");
      $("pageTitle").textContent="美股期权 · 搜索";
      $("ts").textContent="OWNER ONLY";
      document.title="U.S. Options";
    }
    if(rankingsRoute){
      $("sellPutNav").classList.remove("on");
      $("buyCallNav").classList.remove("on");
      $("coveredCallNav").classList.remove("on");
      $("ownerPositionsNav").classList.remove("on");
      $("cryptoMarketNav").classList.remove("on");
      $("usOptionsNav").classList.add("on");
      $("usOptionsNav").setAttribute("aria-current","page");
      $("pageTitle").textContent="OptionRank · 候选";
      $("ts").textContent="OWNER ONLY";
      document.title="U.S. Option Candidates · Owner";
    }
  }

  function rankingFunding(row,strategy){
    const value=String(strategy).startsWith("buy_")
      ?Number(row?.contract_cost_usd)
      :Number(row?.capital_required_usd);
    return Number.isFinite(value)&&value>=0?value:null;
  }

  function rankingSourceHtml(){
    const data=optionRankData;
    const stale=Boolean(data?.stale);
    const statusClass=!data?"":stale?"bad":"warn";
    const statusText=!data?"等待加载":stale?"已过期 · 仅查看":"外部候选 · 禁止决策";
    return `<div><span>数据来源</span><strong>OptionRank Public</strong><small>${esc(data?.upstream_source||"Alpaca Indicative")}</small></div>
      <div class="${statusClass}"><span>状态</span><strong>${statusText}</strong><small>不是 OPRA 可成交报价</small></div>
      <div><span>候选生成</span><strong>${utcDateTime(data?.generated_at)}</strong><small>5 分钟共享缓存</small></div>
      <div><span>市场快照</span><strong>SPY ${money(data?.market?.spy?.price,2)} · QQQ ${money(data?.market?.qqq?.price,2)}</strong><small>${data?`SPY ${signedPct(data.market?.spy?.change_pct)} · QQQ ${signedPct(data.market?.qqq?.change_pct)}`:"等待加载"}</small></div>`;
  }

  function renderOwnerRankings(){
    if(!rankingsRoute)return;
    const source=$("ownerRankingsSource");
    const state=$("ownerRankingsState");
    const refresh=$("ownerRankingsRefresh");
    if(!source||!state)return;
    source.innerHTML=rankingSourceHtml();
    if(refresh){
      refresh.disabled=optionRankLoading;
      refresh.textContent=optionRankLoading?"读取中…":"检查数据";
    }
    if(optionRankLoading&&!optionRankData){
      state.innerHTML='<div class="owner-rankings-message"><strong>正在读取</strong><span>通过我们的后台读取 OptionRank 公开候选，不会强制刷新上游。</span></div>';
      return;
    }
    if(optionRankError&&!optionRankData){
      state.innerHTML=`<div class="owner-rankings-message bad"><strong>数据不可用</strong><span>${esc(optionRankError)}；当前不显示旧候选。</span></div>`;
      return;
    }
    if(!optionRankData){
      state.innerHTML='<div class="owner-rankings-message"><strong>尚未加载</strong><span>点击“检查数据”后按需读取。</span></div>';
      return;
    }
    const strategy=$("ownerRankingStrategy")?.value||"sell_put";
    const horizon=$("ownerRankingHorizon")?.value||"short";
    const maximum=Number($("ownerRankingCapital")?.value||0);
    const upstream=optionRankData.rankings?.[strategy]?.[horizon];
    const allRows=Array.isArray(upstream)?upstream:[];
    const rows=allRows.filter(row=>{
      if(!(maximum>0))return true;
      const funding=rankingFunding(row,strategy);
      return funding!==null&&funding<=maximum;
    }).slice(0,20);
    if(!rows.length){
      state.innerHTML='<div class="owner-rankings-message"><strong>没有候选</strong><span>当前策略、期限和资金上限下没有匹配结果。</span></div>';
      return;
    }
    const fundingLabel=String(strategy).startsWith("buy_")?"合约成本":"资金口径";
    const body=rows.map(row=>{
      const funding=rankingFunding(row,strategy);
      const earnings=row.next_earnings?.date
        ?`下次财报 ${esc(row.next_earnings.date)}${row.next_earnings.estimated?" · 预估":""}`
        :"财报日未提供";
      return `<article class="owner-rankings-row">
        <div class="owner-ranking-ticker"><strong>${esc(row.ticker)}</strong><small>${esc(row.company)}</small></div>
        <div><strong>${esc(row.expiry)} · $${Number(row.strike).toLocaleString("en-US")}</strong><small>${esc(row.contract_symbol)}</small></div>
        <div class="owner-ranking-score"><strong>${Number(row.score).toFixed(1)}</strong><small>覆盖 ${pct(row.data_confidence_pct,0)}</small></div>
        <div><strong>Bid ${money(row.bid_usd,2)} · Ask ${money(row.ask_usd,2)}</strong><small>权利金 ${money(row.premium_usd,2)}</small></div>
        <div><strong>Δ ${row.delta==null?"—":Number(row.delta).toFixed(2)} · IV ${pct(row.iv_pct,0)}</strong><small>Beta ${row.beta==null?"—":Number(row.beta).toFixed(2)}</small></div>
        <div class="owner-ranking-capital"><strong>${money(funding)}</strong><small>${fundingLabel}</small></div>
        <div><strong>${esc(row.reason||"模型候选")}</strong><small>${earnings}</small></div>
      </article>`;
    }).join("");
    state.innerHTML=`<div class="owner-rankings-table">
      <div class="owner-rankings-table-head"><span>标的</span><span>候选合约</span><span>分数</span><span>Bid · Ask</span><span>Delta · IV</span><span>${fundingLabel}</span><span>研究理由</span></div>
      ${body}
    </div>`;
  }

  function ownerRankingsUrl(){
    const fallback=`${supabaseUrl}/functions/v1/options-api`;
    const base=String(
      window.MANGO_API_BASE!==undefined
        ?window.MANGO_API_BASE
        :(["localhost","127.0.0.1"].includes(location.hostname)?"":fallback)
    ).replace(/\/+$/,"");
    return `${base}/api/us-stocks/rankings`;
  }

  async function rankingRequest(){
    await ensureSession();
    return fetch(ownerRankingsUrl(),{
      signal:optionRankController.signal,
      cache:"no-store",
      headers:{
        apikey:anonKey,
        Authorization:`Bearer ${session.access_token}`,
      },
    });
  }

  async function loadOwnerRankings(){
    if(optionRankLoading)return;
    optionRankLoading=true;
    optionRankError="";
    optionRankController?.abort();
    optionRankController=new AbortController();
    renderOwnerRankings();
    try{
      let response=await rankingRequest();
      if(response.status===401){
        await refreshSession({force:true});
        response=await rankingRequest();
      }
      let payload={};
      try{payload=await response.json()}catch(_){}
      if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      if(payload?.source!=="optionrank-public"||!payload?.rankings){
        throw new Error("外部候选返回结构不完整");
      }
      optionRankData=payload;
    }catch(error){
      if(error.name==="AbortError")return;
      optionRankData=null;
      optionRankError=error.message||"候选数据读取失败";
    }finally{
      optionRankLoading=false;
      renderOwnerRankings();
    }
  }

  function installOwnerRankingsUi(){
    const main=document.querySelector("main.wrap");
    if(!$("ownerUsRankingsPage")){
      const page=document.createElement("section");
      page.id="ownerUsRankingsPage";
      page.className="owner-us-rankings-page";
      page.innerHTML=`<header class="owner-rankings-head"><div><span class="owner-kicker">EXTERNAL CANDIDATE FEED</span><h2>美股期权候选</h2><p>只读取 OptionRank 已筛选的候选，不冒充完整期权链。不连接券商，不生成交易指令。</p></div><div class="owner-rankings-actions"><a class="owner-quiet" href="${stockBase}">返回美股搜索</a><button type="button" class="owner-primary" id="ownerRankingsRefresh">检查数据</button><button type="button" class="owner-quiet" id="ownerRankingsLogout">退出</button></div></header>
        <section class="owner-rankings-source" id="ownerRankingsSource" aria-label="外部数据源状态"></section>
        <section class="owner-rankings-controls" aria-label="候选筛选"><label><span>策略</span><select id="ownerRankingStrategy"><option value="sell_put" selected>Sell Put</option><option value="buy_call">Buy Call</option><option value="sell_call">Sell Call</option><option value="buy_put">Buy Put</option></select></label><label><span>期限</span><select id="ownerRankingHorizon"><option value="week">本周</option><option value="short" selected>14–45 天</option><option value="long">90–270 天</option></select></label><label><span>资金上限 USD</span><input id="ownerRankingCapital" type="number" min="0" step="100" inputmode="decimal" placeholder="0 = 不限制"></label><p class="owner-rankings-control-note" id="ownerRankingControlNote">Sell Put 按 OptionRank 资金口径过滤；Buy Call 按单张 Ask 成本过滤。</p></section>
        <section class="owner-rankings-state" id="ownerRankingsState" aria-live="polite"></section>
        <p class="owner-ranking-warning"><strong>研究边界：</strong>这是第三方公开候选源，上游为 Alpaca Indicative，不是 OPRA NBBO，也不是可成交报价。它可能延迟、不完整或随时停止，因此所有候选固定禁止决策。</p>`;
      main.appendChild(page);
      $("ownerRankingsRefresh").addEventListener("click",loadOwnerRankings);
      $("ownerRankingsLogout").addEventListener("click",logout);
      ["ownerRankingStrategy","ownerRankingHorizon","ownerRankingCapital"].forEach(id=>{
        $(id).addEventListener("change",renderOwnerRankings);
        $(id).addEventListener("input",renderOwnerRankings);
      });
    }
    renderOwnerRankings();
  }

  function installOwnerUi(){
    configureNavigation();
    if(rankingsRoute){
      installOwnerRankingsUi();
      return;
    }
    if(stockRoute)return;
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
    if(!$("ownerClosedDialog")){
      document.body.insertAdjacentHTML("beforeend",closedRecordDialogHtml());
      bindClosedRecordDialog();
    }
    if(!$("ownerAccountDialog")){
      document.body.insertAdjacentHTML("beforeend",accountDialogHtml());
      bindAccountDialog();
    }
    renderAccount();
    renderPositions();
  }

  function accountHtml(){
    const account=Strategy.portfolioSummary(ownerState,positions,researchByAsset);
    const capital=Strategy.deribitCapitalSummary(positions,researchByAsset);
    const requiredAssets=heldAssets();
    const requiredResearch=requiredAssets.map(researchFor);
    const stale=requiredResearch.some(payload=>!Strategy.sourceUsable(payload));
    const asofs=requiredResearch.map(payload=>
      Number(payload?.source_status?.chain_asof_epoch_ms)
    ).filter(Number.isFinite);
    const asof=asofs.length?Math.min(...asofs):null;
    const decisions=Strategy.positionRows(ownerState,positions,researchByAsset);
    const attention=decisions.filter(row=>row.decision.state!=="not_due").length;
    const quoteLabel=researchError?"刷新失败":stale?"报价不可用":"最后成功";
    const pnlClass=account.pnl_complete&&account.unrealized_pnl_total>0
      ?"good":account.pnl_complete&&account.unrealized_pnl_total<0?"bad":"muted";
    let capitalBody;
    if(!positions.length){
      capitalBody='<p class="owner-capital-note">录入持仓后显示当前 Deribit Standard Margin 文档估算。</p>';
    }else if(!capital.complete){
      capitalBody='<p class="owner-capital-note">需要各持仓资产的新鲜现价与每笔合约 Mark，当前暂不估算保证金。</p>';
    }else{
      capitalBody=`<div class="owner-capital-grid">
          <div><span>完整经济资本 K×Q</span><strong>${money(capital.capacity_capital)}</strong></div>
          <div><span>净自有资本</span><strong>${money(capital.net_own_capital)}</strong></div>
          <div><span>Deribit 文档 IM</span><strong>${money(capital.initial_margin)}</strong></div>
          <div><span>Deribit 文档 MM</span><strong>${money(capital.maintenance_margin)}</strong></div>
          <div><span>IM 以上专属准备金</span><strong>${money(capital.above_im_dedicated_reserve)}</strong></div>
        </div>
        <p class="owner-capital-note">这是各 USDC 线性期权 Standard Margin 的文档公式估算，不是账户下单预览。“IM 以上专属准备金”可以放在合格生息抵押品或高流动性短债，但仍专属于这些 Put，不能再次计入开仓容量；可转出金额还要扣除 -70% 压力、参数上调、haircut 与 48 小时入金中断缓冲。</p>`;
    }
    return `<div class="owner-account-head"><div><span class="owner-kicker">PRIVATE PORTFOLIO</span><strong>加密期权账户</strong><small>BTC · ETH · HYPE</small></div><div class="owner-account-actions"><button type="button" id="ownerAccountSettings" class="owner-quiet">账户设置</button><button type="button" id="ownerRetry" class="owner-quiet"${researchLoading?" disabled":""}>${researchLoading?"刷新中…":"刷新报价"}</button><button type="button" id="ownerLogout" class="owner-quiet">退出</button></div></div>
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
      <label><span>BTC 买入带下沿</span><input id="ownerBandLow" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="未配置"></label>
      <label><span>BTC 买入带上沿</span><input id="ownerBandHigh" type="number" min="0.00000001" step="any" inputmode="decimal" placeholder="未配置"></label>
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
      const asset=currentMarketAsset();
      decision=Strategy.evaluateEntry(
        ownerState,positions,researchFor(asset),window.MangoDashboard?.getState()?.timing,
      );
    }catch(_){
      decision={state:"unknown",verdict:"暂无法判断",reason:"私有账户数据暂不可用。"};
    }
    node.className=`owner-entry-card ${statusClass(decision.state)}`;
    node.innerHTML=`<span>开仓复核</span><strong>${esc(decision.verdict)}</strong><p>${esc(decision.reason)}</p>`;
  }

  function researchItem(positionValue){
    return (researchFor(positionValue.asset)?.puts||[]).find(candidate=>
      String(candidate.expiry)===String(positionValue.expiry)&&
      Math.abs(Number(candidate.strike)-Number(positionValue.strike))<1e-8
    );
  }

  function stressRangeText(value){
    return Number.isInteger(value)?value.toFixed(0):value.toFixed(1);
  }

  function stressRowsHtml(rows){
    return rows.map(row=>{
      const shock=Number(row.shock_pct);
      const shockLabel=shock.toLocaleString("en-US",{maximumFractionDigits:2});
      return `<tr><td>${shock>0?"+":""}${shockLabel}%</td><td>${money(row.terminal_price)}</td><td class="${Number(row.horizon_return_pct)<0?"bad":""}">${pct(row.horizon_return_pct)}</td><td>${money(row.pnl)}</td></tr>`;
    }).join("");
  }

  function researchCard(positionValue){
    const assetResearch=researchFor(positionValue.asset);
    const item=researchItem(positionValue);
    if(!item?.card)return `<p class="owner-empty">当前链上没有匹配合约，暂无法生成高级研究。</p>`;
    const card=item.card;
    const expected=card.expected||{};
    const positionId=String(positionValue.id);
    const range=stressRangeByPositionId.get(positionId)||30;
    const rangeText=stressRangeText(range);
    const stress=stressRowsHtml(Strategy.stressScenarioRows(positionValue,item,assetResearch?.spot,range));
    return `<div class="owner-research-grid">
        <div><span>条件净 APR</span><strong>${pct(card.net_conditional_apr_pct)}</strong></div>
        <div><span>8% 门槛条件超额</span><strong>${pct(card.conditional_excess_rwa_apr_pct)}</strong></div>
        <div><span>历史 ITM 概率</span><strong>${pct(expected.itm_probability_pct)}</strong></div>
        <div><span>经验期望净 APR</span><strong>${pct(expected.expected_net_apr_pct)}</strong></div>
        <div><span>CVaR95 持有期</span><strong class="bad">${pct(expected.cvar95_horizon_return_pct)}</strong></div>
        <div><span>单周期几何年化</span><strong>${pct(expected.single_cycle_geometric_annualized_pct)}</strong></div>
      </div>
      <div class="owner-stress-controls"><div><span>${positionValue.asset} 到期涨跌区间</span><label class="owner-stress-value"><span>±</span><input type="number" min="1" max="100" step="0.1" value="${rangeText}" inputmode="decimal" data-owner-stress-number="${esc(positionId)}" aria-label="手动输入 ${positionValue.asset} 到期涨跌区间"><span>%</span></label></div><input type="range" min="1" max="100" step="0.1" value="${rangeText}" data-owner-stress-range="${esc(positionId)}" aria-label="拖动 ${positionValue.asset} 到期涨跌区间" aria-valuetext="上下 ${rangeText}%"></div>
      <div class="owner-research-table"><table><thead><tr><th>${positionValue.asset} 路径</th><th>到期价</th><th>持有期回报</th><th>损益</th></tr></thead><tbody data-owner-stress-table="${esc(positionId)}">${stress}</tbody></table></div>
      <p class="owner-research-note">条件 APR 只表示到期未赔付时的收入率；经验分布与压力路径用于人工复核。</p>`;
  }

  function quoteUnavailableReason(positionValue,metrics){
    if(!metrics.quote)return "当前期权链没有匹配合约";
    if(!Strategy.sourceUsable(researchFor(positionValue.asset)))return "报价超过 120 秒或上游不可用";
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

  function positionDetail(row){
    const {position:positionValue,decision,metrics}=row;
    const unavailable=quoteUnavailableReason(positionValue,metrics);
    const spread=metrics.spread_pct===null?"—":pct(metrics.spread_pct);
    const holdingAprUsable=metrics.quote_usable&&metrics.remaining_apr!==null;
    const aprClass=!holdingAprUsable?"muted":metrics.remaining_apr<metrics.exit_apr_threshold?"bad":"good";
    const pnlClass=metrics.quote_usable&&metrics.unrealized_pnl>0
      ?"good":metrics.quote_usable&&metrics.unrealized_pnl<0?"bad":"muted";
    return `<div class="owner-position-detail">
      <div class="owner-inspector-head"><div><span class="owner-kicker">SELECTED POSITION</span><h3>${positionValue.asset} ${money(positionValue.strike)} Put</h3><p>${esc(positionValue.expiry)} · ${positionValue.notional_btc.toLocaleString()} ${positionValue.asset}</p></div><span class="owner-status ${statusClass(decision.state)}">${esc(decision.verdict)}</span></div>
      <div class="owner-inspector-hero">
        <div class="owner-apr-hero ${aprClass}"><span>${metricTip("剩余 APR（毛）","以当前 Ask 代表的剩余权利金、完整 K×Q 与剩余 DTE 简单年化；这是到期归零时的条件上界，不是预期 APY。")}</span><strong>${holdingAprUsable?pct(metrics.remaining_apr):"不可用"}</strong><small>10% 退出线 · 余量 ${holdingAprUsable?signedPp(metrics.remaining_apr_buffer_pp):"不可用"}</small></div>
        <div class="${pnlClass}"><span>未实现 P&amp;L</span><strong>${metrics.quote_usable?signedMoney(metrics.unrealized_pnl,2):"不可用"}</strong><small>${metrics.quote_usable?`已捕获 ${signedPct(metrics.capture_pct)}`:esc(unavailable)}</small></div>
        <div><span>${metricTip("Ask 平仓 / 剩余价值","按当前顶档 Ask 买回的估算成本；若期权最终归零，它也是从今天起最多还能赚到的毛权利金。")}</span><strong>${metrics.quote_usable?money(metrics.close_cost,2):"不可用"}</strong><small>Ask ${money(metrics.current_ask,2)} / ${positionValue.asset}</small></div>
      </div>
      ${progressAxis(metrics)}
      <div class="owner-detail-grid owner-position-facts" role="group" aria-label="持仓期限与权利金">
        <div><span>开仓时间</span><strong>${esc(positionValue.open_date)}</strong></div>
        <div><span>开仓权利金</span><strong>${money(positionValue.open_premium_per_btc,2)} / ${positionValue.asset}</strong><small>合计 ${money(metrics.open_premium_total,2)}</small></div>
        <div><span>到期日</span><strong>${esc(positionValue.expiry)}</strong></div>
        <div><span>剩余天数</span><strong>${days(metrics.dte)}</strong><small>开仓时 ${days(metrics.open_dte)}</small></div>
      </div>
      <div class="owner-detail-grid owner-quote-strip" role="group" aria-label="当前报价">
        <div><span>Bid</span><strong>${money(metrics.current_bid,2)}</strong></div>
        <div><span>Ask · 平仓依据</span><strong>${money(metrics.current_ask,2)}</strong></div>
        <div><span>Mark</span><strong>${money(metrics.current_mark,2)}</strong></div>
      </div>
      <div class="owner-detail-grid owner-risk-facts" role="group" aria-label="波动率与风险指标">
        <div><span>Spread</span><strong>${spread}</strong></div>
        <div><span>IV</span><strong>${pct(metrics.iv)}</strong></div>
        <div><span>Delta</span><strong>${metrics.delta===null?"—":Number(metrics.delta).toFixed(3)}</strong></div>
        <div><span>现价距 Strike</span><strong>${signedPct(metrics.strike_distance_pct)}</strong></div>
      </div>
      ${unavailable?`<p class="owner-quote-warning">${esc(unavailable)}：未实现 P&amp;L、捕获率和基于报价的平仓结论已禁用；用户录入的持仓仍保留。</p>`:""}
      <div class="owner-secondary-actions"><button type="button" class="owner-quiet" data-owner-edit="${esc(positionValue.id)}"${privateReady?"":" disabled"}>编辑持仓</button><button type="button" class="owner-quiet bad" data-owner-delete="${esc(positionValue.id)}"${privateReady?"":" disabled"}>删除持仓</button></div>
      <details class="owner-research-card" open><summary><span>高级研究 / CVaR / 压力测试</span><span>可调压力区间</span></summary>${researchCard(positionValue)}</details>
    </div>`;
  }

  function positionRow(row){
    const {position:positionValue,decision,metrics}=row;
    const expired=Strategy.isExpired(positionValue);
    const expanded=expandedPositionIds.has(positionValue.id);
    const pnlClass=metrics.quote_usable&&metrics.unrealized_pnl>0
      ?"good":metrics.quote_usable&&metrics.unrealized_pnl<0?"bad":"muted";
    const aprUsable=metrics.quote_usable&&metrics.remaining_apr!==null;
    const aprClass=!aprUsable
      ?"muted"
      :metrics.remaining_apr<metrics.exit_apr_threshold
        ?"bad"
        :metrics.remaining_apr<metrics.exit_apr_threshold+4
          ?"warn"
          :"good";
    return `<button type="button" class="owner-position-item ${expanded?"selected":""} ${expired?"owner-expired":""}" data-owner-toggle="${esc(positionValue.id)}" aria-pressed="${expanded}">
      <span class="owner-position-contract"><strong>${positionValue.asset} ${money(positionValue.strike)} Put</strong><small>${esc(positionValue.expiry)} · ${positionValue.notional_btc.toLocaleString()} ${positionValue.asset}</small></span>
      <span class="owner-position-apr ${aprClass}"><strong>${aprUsable?pct(metrics.remaining_apr):"不可用"}</strong><small>剩余 APR</small></span>
      <span class="owner-position-pnl ${pnlClass}"><strong>${metrics.quote_usable?signedMoney(metrics.unrealized_pnl,2):"不可用"}</strong><small>${metrics.quote_usable?`捕获 ${signedPct(metrics.capture_pct)}`:esc(quoteUnavailableReason(positionValue,metrics))}</small></span>
      <span class="owner-position-dte"><strong>${metrics.dte.toFixed(0)} DTE</strong><small>距 Strike ${signedPct(metrics.strike_distance_pct)}</small></span>
      <span class="owner-position-state ${statusClass(decision.state)}"><i></i><strong>${esc(decision.verdict)}</strong></span>
    </button>`;
  }

  function closedRecordRow(record){
    const pnlClass=record.realized_pnl>0?"good":record.realized_pnl<0?"bad":"muted";
    const note=record.notes
      ?`<p class="owner-track-note"><span>复盘备注</span>${esc(record.notes)}</p>`
      :"";
    return `<article class="owner-track-row">
      <div class="owner-track-contract"><strong>${record.asset} ${money(record.strike)} Put</strong><small>${esc(record.expiry)} · ${record.notional.toLocaleString()} ${record.asset}</small></div>
      <div><span>持有期</span><strong>${esc(record.open_date)} → ${esc(record.close_date)}</strong><small>${record.hold_days.toFixed(0)} 天</small></div>
      <div><span>权利金 / 平仓成本</span><strong>${money(record.open_premium_per_unit,2)} / ${money(record.close_cost_per_unit,2)}</strong><small>每 1 ${record.asset}</small></div>
      <div><span>手续费</span><strong>${money(record.fees_usd,2)}</strong></div>
      <div class="owner-track-pnl ${pnlClass}"><span>已实现 P&amp;L</span><strong>${signedMoney(record.realized_pnl,2)}</strong><small>完整 Strike 资本回报 ${signedPct(record.return_on_capital_pct,2)}</small></div>
      <div class="owner-track-actions"><button type="button" class="owner-link" data-owner-closed-edit="${esc(record.id)}">编辑</button><button type="button" class="owner-link bad" data-owner-closed-delete="${esc(record.id)}">删除</button></div>
      ${note}
    </article>`;
  }

  function trackRecordHtml(){
    const summary=Strategy.closedPositionSummary(closedPositions);
    const pnlClass=summary.realized_pnl_total>0?"good":summary.realized_pnl_total<0?"bad":"muted";
    const rows=closedPositions.length
      ?closedPositions.map(closedRecordRow).join("")
      :`<div class="owner-track-empty"><strong>还没有已平仓记录</strong><span>平仓或结算确认后再手动录入，这里不会根据当前持仓自动推算。</span></div>`;
    return `<section class="owner-track-record" aria-labelledby="ownerTrackTitle">
      <div class="owner-track-head"><div><span class="owner-kicker">TRACK RECORD</span><h2 id="ownerTrackTitle">已平仓记录</h2><p>只统计手动确认的已实现盈亏，不与当前持仓和未实现收益混合。</p></div><button type="button" class="owner-primary" id="ownerClosedAdd"${privateReady?"":" disabled"}>＋ 录入平仓</button></div>
      <div class="owner-track-summary" aria-label="已平仓绩效汇总">
        <div class="owner-track-metric owner-track-total ${pnlClass}"><span>累计已实现 P&amp;L</span><strong>${signedMoney(summary.realized_pnl_total,2)}</strong><small>已扣录入的手续费</small></div>
        <div class="owner-track-metric"><span>平仓笔数</span><strong>${summary.count}</strong><small>手动确认记录</small></div>
        <div class="owner-track-metric"><span>胜率</span><strong>${summary.win_rate_pct===null?"—":pct(summary.win_rate_pct)}</strong><small>${summary.win_count} 赢 / ${summary.loss_count} 亏 / ${summary.flat_count} 平</small></div>
        <div class="owner-track-metric"><span>累计手续费</span><strong>${money(summary.fees_total,2)}</strong><small>仅计已录入费用</small></div>
      </div>
      <div class="owner-track-list">${rows}</div>
    </section>`;
  }

  function renderPositions(){
    const page=$("ownerPositionsPage");
    if(!page)return;
    if(!positionsRoute){page.hidden=true;return}
    page.hidden=false;
    const entryCard=$("ownerEntryCard");
    const allRows=Strategy.positionRows(ownerState,positions,researchByAsset);
    const attentionCount=allRows.filter(row=>row.decision.state!=="not_due").length;
    const normalCount=allRows.length-attentionCount;
    const visibleRows=Strategy.positionRows(ownerState,positions,researchByAsset,Date.now(),positionFilter);
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
      <div class="owner-workspace"><section class="owner-list-panel" aria-label="持仓列表"><div class="owner-position-toolbar" role="group" aria-label="持仓过滤"><button type="button" data-owner-filter="all" aria-pressed="${positionFilter==="all"}">全部 <strong>${allRows.length}</strong></button><button type="button" data-owner-filter="attention" aria-pressed="${positionFilter==="attention"}">需处理 <strong>${attentionCount}</strong></button><button type="button" data-owner-filter="normal" aria-pressed="${positionFilter==="normal"}">正常 <strong>${normalCount}</strong></button></div><div class="owner-position-list">${rows}</div></section><aside class="owner-position-inspector" aria-label="持仓详情">${selectedRow?positionDetail(selectedRow):`<div class="owner-empty">选择一笔持仓查看详情。</div>`}</aside></div>
      ${trackRecordHtml()}`;
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
    $("ownerClosedAdd")?.addEventListener("click",()=>openClosedRecordDialog());
    page.querySelectorAll("[data-owner-closed-edit]").forEach(button=>button.addEventListener("click",()=>{
      openClosedRecordDialog(closedPositions.find(row=>row.id===button.dataset.ownerClosedEdit));
    }));
    page.querySelectorAll("[data-owner-closed-delete]").forEach(button=>button.addEventListener("click",()=>deleteClosedRecord(button.dataset.ownerClosedDelete)));
    const applyStressRange=(id,rawValue)=>{
      const range=Strategy.normalizeStressRange(rawValue);
      if(range===null)return;
      stressRangeByPositionId.set(id,range);
      const rangeText=stressRangeText(range);
      const slider=page.querySelector(`[data-owner-stress-range="${CSS.escape(id)}"]`);
      const number=page.querySelector(`[data-owner-stress-number="${CSS.escape(id)}"]`);
      if(slider){slider.value=rangeText;slider.setAttribute("aria-valuetext",`上下 ${rangeText}%`)}
      if(number)number.value=rangeText;
      const table=page.querySelector(`[data-owner-stress-table="${CSS.escape(id)}"]`);
      const positionValue=positions.find(row=>String(row.id)===id);
      const item=positionValue?researchItem(positionValue):null;
      if(table&&item)table.innerHTML=stressRowsHtml(Strategy.stressScenarioRows(positionValue,item,researchFor(positionValue.asset)?.spot,range));
    };
    page.querySelectorAll("[data-owner-stress-range]").forEach(input=>input.addEventListener("input",()=>{
      applyStressRange(input.dataset.ownerStressRange,input.value);
    }));
    page.querySelectorAll("[data-owner-stress-number]").forEach(input=>{
      input.addEventListener("input",()=>{
        if(input.value!=="")applyStressRange(input.dataset.ownerStressNumber,input.value);
      });
      input.addEventListener("change",()=>{
        applyStressRange(input.dataset.ownerStressNumber,input.value||30);
      });
    });
  }

  function positionDialogHtml(){
    return `<dialog id="ownerPositionDialog" class="owner-dialog owner-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="ownerDialogTitle"><form id="ownerPositionForm" method="dialog"><div class="owner-dialog-head"><div><span class="owner-kicker">POSITION LEDGER</span><h2 id="ownerDialogTitle">加入持仓</h2><p class="owner-dialog-subtitle">记录已有仓位，用于跟踪权利金与平仓时点。</p></div><button type="button" class="owner-dialog-close" id="ownerDialogClose" aria-label="关闭">×</button></div><input type="hidden" id="ownerPositionId"><div class="owner-form-grid">
      <label><span>资产</span><select id="ownerPositionAsset" required><option value="BTC">BTC</option><option value="ETH">ETH</option><option value="HYPE">HYPE</option></select></label>
      <label><span>行权价</span><input id="ownerPositionStrike" type="number" min="0" step="any" inputmode="decimal" placeholder="例如 60000" required></label>
      <label><span>到期日</span><input id="ownerPositionExpiry" type="date" required></label>
      <label><span id="ownerPositionNotionalLabel">BTC 名义数量</span><input id="ownerPositionNotional" type="number" min="0.01" step="any" inputmode="decimal" value="1" required></label>
      <label><span id="ownerPositionPremiumLabel">开仓权利金 / 1 BTC</span><input id="ownerPositionPremium" type="number" min="0" step="any" inputmode="decimal" placeholder="每 BTC 收到的权利金" required></label>
      <label><span>开仓日期</span><input id="ownerPositionOpenDate" type="date" required></label>
    </div><p class="owner-form-note" id="ownerPositionNote">Deribit BTC_USDC · USDC 现金结算 · 资本占用按行权价 × 名义数量</p><div class="owner-dialog-error" id="ownerDialogError" role="alert"></div><div class="owner-dialog-actions"><button type="button" class="owner-quiet" id="ownerDialogCancel">取消</button><button type="submit" class="owner-primary" id="ownerDialogSave">添加持仓</button></div></form></dialog>`;
  }

  function updatePositionAssetUi({resetNotional=false}={}){
    const asset=Strategy.normalizeAsset($("ownerPositionAsset").value);
    const defaults=ASSET_DEFAULTS[asset];
    $("ownerPositionNotionalLabel").textContent=`${asset} 名义数量`;
    $("ownerPositionPremiumLabel").textContent=`开仓权利金 / 1 ${asset}`;
    $("ownerPositionNotional").min=String(defaults.min);
    if(resetNotional)$("ownerPositionNotional").value=String(defaults.notional);
    $("ownerPositionNote").textContent=`Deribit ${asset}_USDC · USDC 现金结算 · 资本占用按行权价 × 名义数量`;
  }

  function bindPositionDialog(){
    $("ownerDialogClose").addEventListener("click",closePositionDialog);
    $("ownerDialogCancel").addEventListener("click",closePositionDialog);
    $("ownerPositionAsset").addEventListener("change",()=>{
      updatePositionAssetUi({resetNotional:true});
      localStorage.setItem(DRAFT_KEY,JSON.stringify(positionDraft()));
    });
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
      asset:$("ownerPositionAsset").value,kind:"sell_put",
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
    const asset=Strategy.normalizeAsset(row.asset||currentMarketAsset());
    $("ownerDialogTitle").textContent=existing?"编辑 Sell Put 持仓":"新增 Sell Put 持仓";
    $("ownerDialogSave").textContent=existing?"保存修改":"添加持仓";
    $("ownerPositionId").value=existing?.id||"";
    $("ownerPositionAsset").value=asset;
    $("ownerPositionAsset").disabled=Boolean(existing);
    $("ownerPositionStrike").value=inputValue(row.strike);
    $("ownerPositionExpiry").value=row.expiry||"";
    $("ownerPositionNotional").value=inputValue(
      row.notional_btc??row.min_trade_amount??ASSET_DEFAULTS[asset].notional,
    );
    $("ownerPositionPremium").value=inputValue(row.open_premium_per_btc??row.bid_usd??0);
    $("ownerPositionOpenDate").value=row.open_date||today();
    updatePositionAssetUi();
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
        owner_id:session.user.id,asset:normalized.asset,kind:"sell_put",
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
    if(!row||!confirm(`删除 ${row.asset} ${money(row.strike)} Put · ${row.expiry}？请先确认现金结算或记账状态。`))return;
    try{
      await rest(`positions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${session.user.id}`,{
        method:"DELETE",prefer:"return=minimal",
      });
      expandedPositionIds.delete(id);
      await loadPrivateData();
      setNotice("持仓已删除。","ok");
    }catch(error){privateError=error.message;renderAccount()}
  }

  function closedRecordDialogHtml(){
    return `<dialog id="ownerClosedDialog" class="owner-dialog owner-entry-dialog owner-closed-dialog" role="dialog" aria-modal="true" aria-labelledby="ownerClosedTitle"><form id="ownerClosedForm" method="dialog"><div class="owner-dialog-head"><div><span class="owner-kicker">TRACK RECORD</span><h2 id="ownerClosedTitle">录入平仓记录</h2><p class="owner-dialog-subtitle">只记录已确认的实现结果，不读取交易所数据。</p></div><button type="button" class="owner-dialog-close" id="ownerClosedClose" aria-label="关闭">×</button></div><input type="hidden" id="ownerClosedId"><div class="owner-form-grid">
      <label><span>资产</span><select id="ownerClosedAsset" required><option value="BTC">BTC</option><option value="ETH">ETH</option><option value="HYPE">HYPE</option></select></label>
      <label><span>行权价</span><input id="ownerClosedStrike" type="number" min="0" step="any" inputmode="decimal" placeholder="例如 60000" required></label>
      <label><span>到期日</span><input id="ownerClosedExpiry" type="date" required></label>
      <label><span id="ownerClosedNotionalLabel">BTC 名义数量</span><input id="ownerClosedNotional" type="number" min="0.01" step="any" inputmode="decimal" value="1" required></label>
      <label><span>开仓日期</span><input id="ownerClosedOpenDate" type="date" required></label>
      <label><span>平仓 / 结算日期</span><input id="ownerClosedCloseDate" type="date" required></label>
      <label><span id="ownerClosedPremiumLabel">开仓权利金 / 1 BTC</span><input id="ownerClosedPremium" type="number" min="0" step="any" inputmode="decimal" placeholder="开仓时收到" required></label>
      <label><span id="ownerClosedCostLabel">平仓 / 结算成本 / 1 BTC</span><input id="ownerClosedCost" type="number" min="0" step="any" inputmode="decimal" placeholder="归零时填 0" required></label>
      <label><span>手续费 USD</span><input id="ownerClosedFees" type="number" min="0" step="any" inputmode="decimal" value="0" required></label>
      <label class="owner-form-wide"><span>复盘备注（可选）</span><textarea id="ownerClosedNotes" maxlength="500" rows="3" placeholder="例如：按 70/25 规则平仓，或到期结算。"></textarea></label>
    </div><div class="owner-closed-preview" id="ownerClosedPreview" aria-live="polite"><span>已实现 P&amp;L</span><strong>补全必填数据后计算</strong><small>（开仓权利金 − 平仓/结算成本）× 名义数量 − 手续费</small></div><div class="owner-dialog-error" id="ownerClosedError" role="alert"></div><div class="owner-dialog-actions"><button type="button" class="owner-quiet" id="ownerClosedCancel">取消</button><button type="submit" class="owner-primary" id="ownerClosedSave">添加记录</button></div></form></dialog>`;
  }

  function updateClosedAssetUi({resetNotional=false}={}){
    const asset=Strategy.normalizeAsset($("ownerClosedAsset").value);
    const defaults=ASSET_DEFAULTS[asset];
    $("ownerClosedNotionalLabel").textContent=`${asset} 名义数量`;
    $("ownerClosedPremiumLabel").textContent=`开仓权利金 / 1 ${asset}`;
    $("ownerClosedCostLabel").textContent=`平仓 / 结算成本 / 1 ${asset}`;
    $("ownerClosedNotional").min=String(defaults.min);
    if(resetNotional)$("ownerClosedNotional").value=String(defaults.notional);
  }

  function closedRecordDraft(){
    return {
      id:$("ownerClosedId").value||"draft",
      asset:$("ownerClosedAsset").value,kind:"sell_put",
      strike:$("ownerClosedStrike").value,
      expiry:$("ownerClosedExpiry").value,
      notional:$("ownerClosedNotional").value,
      open_premium_per_unit:$("ownerClosedPremium").value,
      close_cost_per_unit:$("ownerClosedCost").value,
      fees_usd:$("ownerClosedFees").value,
      open_date:$("ownerClosedOpenDate").value,
      close_date:$("ownerClosedCloseDate").value,
      notes:$("ownerClosedNotes").value,
    };
  }

  function updateClosedRecordPreview(){
    const preview=$("ownerClosedPreview");
    try{
      const record=Strategy.normalizeClosedPosition(closedRecordDraft());
      const pnlClass=record.realized_pnl>0?"good":record.realized_pnl<0?"bad":"muted";
      preview.className=`owner-closed-preview ${pnlClass}`;
      preview.innerHTML=`<span>已实现 P&amp;L</span><strong>${signedMoney(record.realized_pnl,2)}</strong><small>毛损益 ${signedMoney(record.gross_pnl,2)} · 手续费 ${money(record.fees_usd,2)} · 完整 Strike 资本回报 ${signedPct(record.return_on_capital_pct,2)}</small>`;
    }catch(_){
      preview.className="owner-closed-preview muted";
      preview.innerHTML=`<span>已实现 P&amp;L</span><strong>补全必填数据后计算</strong><small>（开仓权利金 − 平仓/结算成本）× 名义数量 − 手续费</small>`;
    }
  }

  function bindClosedRecordDialog(){
    $("ownerClosedClose").addEventListener("click",closeClosedRecordDialog);
    $("ownerClosedCancel").addEventListener("click",closeClosedRecordDialog);
    $("ownerClosedDialog").addEventListener("cancel",event=>{
      event.preventDefault();
      closeClosedRecordDialog();
    });
    $("ownerClosedAsset").addEventListener("change",()=>{
      updateClosedAssetUi({resetNotional:true});
      updateClosedRecordPreview();
    });
    $("ownerClosedForm").addEventListener("submit",event=>{
      event.preventDefault();
      saveClosedRecord();
    });
    $("ownerClosedForm").addEventListener("input",()=>{
      if(!$("ownerClosedId").value){
        localStorage.setItem(CLOSED_DRAFT_KEY,JSON.stringify(closedRecordDraft()));
      }
      updateClosedRecordPreview();
    });
  }

  function openClosedRecordDialog(existing=null){
    const draft=existing?null:readStoredJson(CLOSED_DRAFT_KEY);
    const row=existing||draft||{};
    const asset=Strategy.normalizeAsset(row.asset||currentMarketAsset());
    $("ownerClosedTitle").textContent=existing?"编辑平仓记录":"录入平仓记录";
    $("ownerClosedSave").textContent=existing?"保存修改":"添加记录";
    $("ownerClosedId").value=existing?.id||"";
    $("ownerClosedAsset").value=asset;
    $("ownerClosedStrike").value=inputValue(row.strike);
    $("ownerClosedExpiry").value=row.expiry||"";
    $("ownerClosedNotional").value=inputValue(row.notional??ASSET_DEFAULTS[asset].notional);
    $("ownerClosedOpenDate").value=row.open_date||today();
    $("ownerClosedCloseDate").value=row.close_date||today();
    $("ownerClosedPremium").value=inputValue(row.open_premium_per_unit);
    $("ownerClosedCost").value=inputValue(row.close_cost_per_unit);
    $("ownerClosedFees").value=inputValue(row.fees_usd??0);
    $("ownerClosedNotes").value=row.notes||"";
    updateClosedAssetUi();
    updateClosedRecordPreview();
    $("ownerClosedError").textContent="";
    const dialog=$("ownerClosedDialog");
    if(dialog.showModal)dialog.showModal();
    else dialog.setAttribute("open","");
  }

  function closeClosedRecordDialog(){
    const dialog=$("ownerClosedDialog");
    if(dialog.close)dialog.close();
    else dialog.removeAttribute("open");
  }

  async function saveClosedRecord(){
    const button=$("ownerClosedSave");
    const errorNode=$("ownerClosedError");
    const editing=Boolean($("ownerClosedId").value);
    try{
      const normalized=Strategy.normalizeClosedPosition(closedRecordDraft());
      const body={
        owner_id:session.user.id,asset:normalized.asset,kind:"sell_put",
        strike:normalized.strike,expiry:normalized.expiry,
        notional:normalized.notional,
        open_premium_per_unit:normalized.open_premium_per_unit,
        close_cost_per_unit:normalized.close_cost_per_unit,
        fees_usd:normalized.fees_usd,open_date:normalized.open_date,
        close_date:normalized.close_date,notes:normalized.notes,
      };
      button.disabled=true;
      button.textContent="保存中…";
      const id=$("ownerClosedId").value;
      const rows=await rest(
        id?`closed_positions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${session.user.id}`:"closed_positions",
        {method:id?"PATCH":"POST",body,prefer:"return=representation"},
      );
      if(!rows?.length)throw new Error("平仓记录没有保存成功");
      localStorage.removeItem(CLOSED_DRAFT_KEY);
      closeClosedRecordDialog();
      await loadPrivateData();
      setNotice(editing?"平仓记录已更新。":"平仓记录已加入。","ok");
    }catch(error){
      errorNode.textContent=error.message;
    }finally{
      button.disabled=false;
      button.textContent=editing?"保存修改":"添加记录";
    }
  }

  async function deleteClosedRecord(id){
    const row=closedPositions.find(record=>record.id===id);
    if(!row||!confirm(`删除 ${row.asset} ${money(row.strike)} Put 的平仓记录？这会改变累计已实现盈亏。`))return;
    try{
      await rest(`closed_positions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${session.user.id}`,{
        method:"DELETE",prefer:"return=minimal",
      });
      await loadPrivateData();
      setNotice("平仓记录已删除。","ok");
    }catch(error){
      privateError=error.message;
      renderAccount();
      renderPositions();
    }
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
      const [stateRows,positionRows,closedRows]=await Promise.all([
        rest(`owner_state?select=*&owner_id=eq.${session.user.id}&limit=1`),
        rest(`positions?select=*&owner_id=eq.${session.user.id}&order=expiry.asc,created_at.asc`),
        rest(`closed_positions?select=*&owner_id=eq.${session.user.id}&order=close_date.desc,created_at.desc`),
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
      closedPositions=(closedRows||[]).map(Strategy.normalizeClosedPosition);
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

  function researchUrl(asset){
    return window.MangoDashboard?.apiUrl?.("/api/owner-research",asset)||
      `${projectBase}/api/owner-research?asset=${encodeURIComponent(asset)}`;
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
      const results=await Promise.allSettled(OWNER_ASSETS.map(async asset=>{
        const response=await fetch(researchUrl(asset),{
          signal:refreshController.signal,cache:"no-store",
        });
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
        if(payload?.asset!==asset)throw new Error(`${asset} 报价资产不匹配`);
        return {asset,payload};
      }));
      if(refreshController.signal.aborted||version!==refreshVersion)return;
      const next={...researchByAsset};
      const failed=[];
      for(let index=0;index<results.length;index++){
        const asset=OWNER_ASSETS[index];
        const result=results[index];
        if(result.status==="fulfilled")next[asset]=result.value.payload;
        else{
          failed.push(asset);
          if(next[asset])next[asset]={...next[asset],source_status:{
            ...(next[asset].source_status||{}),chain_stale:true,
          }};
        }
      }
      researchByAsset=next;
      lastResearchAt=Date.now();
      if(failed.length){
        researchError=`${failed.join(" / ")} 报价刷新失败；已停止用于损益和平仓结论。`;
        setNotice(`${failed.join(" / ")} 报价刷新失败，可重试。`,"bad");
      }
    }catch(error){
      if(error.name==="AbortError"||version!==refreshVersion)return;
      researchError="报价刷新失败；旧报价已停止用于损益和平仓结论。";
      for(const asset of OWNER_ASSETS){
        if(researchByAsset[asset])researchByAsset[asset]={
          ...researchByAsset[asset],source_status:{
            ...(researchByAsset[asset].source_status||{}),chain_stale:true,
          },
        };
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
    const asset=currentMarketAsset();
    const matches=positions.filter(position=>
      position.asset===asset&&
      String(position.expiry)===String(row.expiry)&&
      Math.abs(Number(position.strike)-Number(row.strike))<1e-8
    );
    const payload=encodeURIComponent(JSON.stringify({
      asset,
      strike:Number(row.strike),expiry:String(row.expiry),
      bid_usd:Number(row.bid_usd)||0,
      min_trade_amount:Number(row.min_trade_amount)||ASSET_DEFAULTS[asset].notional,
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
      if(!researchFor(currentMarketAsset())||Date.now()-lastResearchAt>30000){
        refreshResearch();
      }
    });
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden){scheduleRefresh();return}
      adoptLatestStoredSession();
      if(!window.MangoOwner.isActive){scheduleAuthRefresh(0);return}
      loadPrivateData();refreshResearch(true);scheduleRefresh();
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
    if(rankingsRoute){
      await loadOwnerRankings();
      return;
    }
    bindGlobalActionsOnce();
    if(stockRoute){
      const ticker=new URLSearchParams(window.location.search).get("ticker")||"";
      if(ticker){
        const prepared=window.MangoDashboard?.prepareStock?.(ticker);
        if(prepared)window.MangoDashboard?.start?.();
        else window.MangoDashboard?.prepareStockSearch?.();
      }else{
        window.MangoDashboard?.prepareStockSearch?.();
      }
      return;
    }
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
    window.MangoOwner={isActive:false,chainHeader,chainCell,authorizedFetch};
    if(stockRoute){
      document.querySelector(".owner-login-mark").textContent="PRIVATE MARKET DATA";
      document.querySelector("#ownerLogin h1").textContent="美股期权";
      document.querySelector("#ownerLogin h1 + p").textContent="登录后按股票代码查看延迟期权链；研究用，不用于下单。";
    }
    window.addEventListener("storage",handleSessionStorage);
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
    }catch(error){scheduleAuthRetry(error)}
  }

  boot();
})();
