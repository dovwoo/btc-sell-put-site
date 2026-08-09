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
  const Journal=window.DecisionJournal;
  if(!Journal)throw new Error("DecisionJournal is required");
  const Portfolio=window.PortfolioRisk;
  if(!Portfolio)throw new Error("PortfolioRisk is required");
  const Scenario=window.ScenarioStress;
  if(!Scenario)throw new Error("ScenarioStress is required");
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
  const reviewRoute=ownerSuffix==="review";
  const portfolioRoute=ownerSuffix==="portfolio";
  const scenarioRoute=ownerSuffix==="scenario";
  const shareRoute=ownerSuffix==="share";
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
  const localPreview=["localhost","127.0.0.1"].includes(location.hostname)&&
    new URLSearchParams(location.search).get("preview")==="1";
  const LOCAL_PREVIEW_OWNER_ID="00000000-0000-0000-0000-000000000000";
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
  let openSnapshots=[];
  let closeReviews=[];
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
  let closeFeeAuto=false;
  let optionRankData=null;
  let optionRankLoading=false;
  let optionRankError="";
  let optionRankController=null;
  let openContextController=null;
  let openContextTimer=null;
  let openContextValue=null;
  let openContextKey="";
  let openContextVersion=0;
  const reviewFilters={month:"all",asset:"all",rule:"all"};
  let portfolioTab="delta";
  let portfolioStressRange=30;
  let scenarioValue={price_shock_pct:0,iv_shock_points:0,time_days:0};
  let scenarioRenderTimer=null;
  let shareLinks=[];
  let shareLoading=false;
  let shareError="";

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
    if(localPreview){
      const headers=new Headers(init.headers||{});
      headers.set("X-Mango-Owner-Request","1");
      return fetch(input,{...init,headers});
    }
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
    if(localPreview)return session;
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
    if(localPreview){
      if(method==="GET")return [];
      throw new Error("本地预览模式不会写入生产私有账本");
    }
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
    openSnapshots=[];
    closeReviews=[];
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
    document.documentElement.classList.toggle("owner-review-route",reviewRoute);
    document.documentElement.classList.toggle("owner-portfolio-route",portfolioRoute);
    document.documentElement.classList.toggle("owner-scenario-route",scenarioRoute);
    document.documentElement.classList.toggle("owner-share-route",shareRoute);
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
    if(!$("ownerReviewNav")){
      const link=document.createElement("a");
      link.id="ownerReviewNav";
      link.href=`${ownerBase}review/`;
      link.textContent="复盘";
      link.className="utility-nav";
      headerRight.insertBefore(link,$("ts"));
    }
    if(!$("ownerPortfolioNav")){
      const link=document.createElement("a");
      link.id="ownerPortfolioNav";
      link.href=`${ownerBase}portfolio/`;
      link.textContent="组合";
      link.className="utility-nav";
      headerRight.insertBefore(link,$("ownerReviewNav"));
    }
    if(!$("ownerScenarioNav")){
      const link=document.createElement("a");
      link.id="ownerScenarioNav";
      link.href=`${ownerBase}scenario/`;
      link.textContent="情景";
      link.className="utility-nav";
      headerRight.insertBefore(link,$("ownerReviewNav"));
    }
    if(!$("ownerShareNav")){
      const link=document.createElement("a");
      link.id="ownerShareNav";
      link.href=`${ownerBase}share/`;
      link.textContent="分享";
      link.className="utility-nav";
      headerRight.insertBefore(link,$("ownerReviewNav"));
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
    if(reviewRoute){
      for(const id of ["sellPutNav","buyCallNav","coveredCallNav","ownerPositionsNav","ownerPortfolioNav","ownerScenarioNav","ownerShareNav","cryptoMarketNav","usOptionsNav"]){
        $(id)?.classList.remove("on");
        $(id)?.removeAttribute("aria-current");
      }
      $("ownerReviewNav").classList.add("on");
      $("ownerReviewNav").setAttribute("aria-current","page");
      $("pageTitle").textContent="Sell Put · 复盘";
      $("ts").textContent="OWNER ONLY";
      document.title="Sell Put Review · Owner";
    }
    if(portfolioRoute){
      for(const id of ["sellPutNav","buyCallNav","coveredCallNav","ownerPositionsNav","ownerReviewNav","ownerScenarioNav","ownerShareNav","cryptoMarketNav","usOptionsNav"]){
        $(id)?.classList.remove("on");
        $(id)?.removeAttribute("aria-current");
      }
      $("ownerPortfolioNav").classList.add("on");
      $("ownerPortfolioNav").setAttribute("aria-current","page");
      $("pageTitle").textContent="Sell Put · 组合风险";
      $("ts").textContent="OWNER ONLY";
      document.title="Portfolio Risk · Owner";
    }
    if(scenarioRoute){
      for(const id of ["sellPutNav","buyCallNav","coveredCallNav","ownerPositionsNav","ownerReviewNav","ownerPortfolioNav","ownerShareNav","cryptoMarketNav","usOptionsNav"]){
        $(id)?.classList.remove("on");
        $(id)?.removeAttribute("aria-current");
      }
      $("ownerScenarioNav").classList.add("on");
      $("ownerScenarioNav").setAttribute("aria-current","page");
      $("pageTitle").textContent="Sell Put · 情景压力";
      $("ts").textContent="OWNER ONLY";
      document.title="Scenario Stress · Owner";
    }
    if(shareRoute){
      for(const id of ["sellPutNav","buyCallNav","coveredCallNav","ownerPositionsNav","ownerReviewNav","ownerPortfolioNav","ownerScenarioNav","cryptoMarketNav","usOptionsNav"]){
        $(id)?.classList.remove("on");
        $(id)?.removeAttribute("aria-current");
      }
      $("ownerShareNav").classList.add("on");
      $("ownerShareNav").setAttribute("aria-current","page");
      $("pageTitle").textContent="Sell Put · 分享";
      $("ts").textContent="OWNER ONLY";
      document.title="Read-only Share · Owner";
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

  function snapshotForPosition(positionId){
    return openSnapshots.find(row=>String(row.position_id)===String(positionId||""))||null;
  }

  function reviewMetric(label,value,detail=""){
    return `<div class="owner-review-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail?`<small>${esc(detail)}</small>`:""}</div>`;
  }

  function reviewGroup(title,rows){
    if(!rows.length)return "";
    const cells=rows.map(row=>`<div class="owner-review-bucket"><strong>${esc(row.key)}</strong><span>${row.count} 笔 · 胜率 ${row.win_rate_pct===null?"—":pct(row.win_rate_pct)}</span><small>累计 ${signedMoney(row.realized_pnl_total,2)} · 平均捕获 ${row.average_capture_pct===null?"—":pct(row.average_capture_pct)}</small></div>`).join("");
    return `<section class="owner-review-group"><h3>${esc(title)}</h3><div>${cells}</div></section>`;
  }

  function snapshotReviewHtml(snapshot){
    if(!snapshot)return `<div class="owner-review-empty-snapshot"><strong>未记录开仓快照</strong><span>历史仓位仍可填写平仓复盘。</span></div>`;
    const context=snapshot.market_context||{};
    const regime=context.market_regime?.label||"—";
    const quality=Journal.CONTEXT_LABELS[snapshot.context_capture_method]||"不可恢复";
    const contextIv=context.dvol_pct??context.implied_vol_pct;
    return `<div class="owner-review-snapshot-grid">
      <div><span>平台</span><strong>${esc(Journal.VENUE_LABELS[snapshot.venue]||snapshot.venue)}</strong></div>
      <div><span>环境数据</span><strong>${esc(quality)}</strong><small>${esc(snapshot.open_time_precision==="minute"?"分钟级":"日级")}</small></div>
      <div><span>开仓现价</span><strong>${money(snapshot.spot_usd,2)}</strong></div>
      <div><span>7D / 30D</span><strong>${signedPct(context.price_change_7d_pct)} / ${signedPct(context.price_change_30d_pct)}</strong></div>
      <div><span>RV / DVOL·IV</span><strong>${pct(context.realized_vol_pct)} / ${pct(contextIv)}</strong></div>
      <div><span>IV 分位 / VRP</span><strong>${pct(context.iv_percentile_pct)} / ${context.vrp_pct==null?"—":`${Number(context.vrp_pct).toFixed(1)} pp`}</strong></div>
      <div><span>恐惧贪婪</span><strong>${context.fear_greed==null?"—":Number(context.fear_greed).toFixed(0)}</strong></div>
      <div><span>期权 IV</span><strong>${snapshot.iv_pct===null?"—":pct(snapshot.iv_pct*100)}</strong></div>
      <div><span>Delta</span><strong>${snapshot.delta===null?"—":Number(snapshot.delta).toFixed(3)}</strong></div>
      <div><span>条件 APR</span><strong>${snapshot.conditional_apr_pct===null?"—":pct(snapshot.conditional_apr_pct)}</strong></div>
      <div><span>超额 RWA APR</span><strong>${snapshot.expected_excess_rwa_apr_pct===null?"—":pct(snapshot.expected_excess_rwa_apr_pct)}</strong></div>
      <div><span>CVaR95</span><strong>${money(snapshot.cvar95_usd,2)}</strong></div>
      <div><span>报价新鲜度</span><strong>${snapshot.quote_freshness_seconds===null?"不可恢复":`${snapshot.quote_freshness_seconds}s`}</strong></div>
      <p><span>市场状态</span>${esc(regime)}</p>
      <p><span>当时为什么开</span>${esc(snapshot.reason_text||"未填写")}</p>
    </div>`;
  }

  function reviewRowHtml(row){
    const {closed,snapshot,review}=row;
    const rule=Journal.EXIT_LABELS[review?.exit_reason_code]||"未分类";
    const repeat=review?.would_repeat===true?"true":review?.would_repeat===false?"false":"";
    return `<article class="owner-review-row" data-owner-review-row="${esc(closed.id)}">
      <header><div><span>${esc(closed.close_date)} · ${esc(rule)}</span><strong>${esc(closed.asset)} ${money(closed.strike)} Put</strong><small>${closed.notional.toLocaleString()} ${esc(closed.asset)} · 持有 ${row.held_days.toFixed(0)} 天</small></div><div class="${row.realized_pnl>0?"good":row.realized_pnl<0?"bad":"muted"}"><span>已实现 P&amp;L</span><strong>${signedMoney(row.realized_pnl,2)}</strong><small>捕获 ${row.capture_pct===null?"—":signedPct(row.capture_pct)} · K×Q 年化 ${row.realized_apr_on_kq_pct===null?"—":pct(row.realized_apr_on_kq_pct)}</small></div></header>
      <details${row.reviewed?"":" open"}><summary><span>${row.reviewed?"查看 / 编辑复盘":"待补复盘"}</span><small>${review?.hit_70_capture===true&&review?.hit_25_time===true?"命中 70/25":"未同时命中 70/25"}</small></summary><div class="owner-review-compare"><section><h4>开仓快照</h4>${snapshotReviewHtml(snapshot)}</section><form data-owner-review-form="${esc(closed.id)}"><h4>平仓后复盘</h4><label><span>如果重来一次</span><select name="would_repeat"><option value=""${repeat===""?" selected":""}>不确定 / 未表态</option><option value="true"${repeat==="true"?" selected":""}>仍会这样做</option><option value="false"${repeat==="false"?" selected":""}>不会这样做</option></select></label><label><span>这笔交易学到了什么</span><textarea name="review_text" maxlength="1000" rows="6" placeholder="记录判断、执行偏差和下一次要保留或避免的做法。">${esc(review?.review_text||"")}</textarea></label><div class="owner-review-save"><span role="status"></span><button type="submit" class="owner-primary">保存复盘</button></div></form></div></details>
    </article>`;
  }

  function renderOwnerReview(){
    if(!reviewRoute)return;
    const page=$("ownerReviewPage");
    if(!page)return;
    if(!privateReady){
      page.innerHTML=`<div class="owner-private-error">${esc(privateError||"正在读取私有复盘数据…")}</div>`;
      return;
    }
    const allRows=Journal.joinReviewRows(closedPositions,openSnapshots,closeReviews);
    const summary=Journal.strategySummary(allRows);
    const months=[...new Set(allRows.map(row=>String(row.closed.close_date||"").slice(0,7)).filter(Boolean))].sort().reverse();
    const visible=Journal.filterRows(allRows,reviewFilters);
    page.innerHTML=`<header class="owner-review-head"><div><span class="owner-kicker">DECISION JOURNAL</span><h2>Sell Put 决策复盘</h2><p>把开仓时能看到的证据，与平仓后的实际结果放在一起。</p></div><a class="owner-quiet" href="${ownerBase}">返回持仓</a></header>
      <section class="owner-review-summary" aria-label="复盘汇总">
        ${reviewMetric("已平仓",String(summary.all.count),"人工确认记录")}
        ${reviewMetric("胜率",summary.all.win_rate_pct===null?"—":pct(summary.all.win_rate_pct),`${summary.all.wins} 笔盈利`)}
        ${reviewMetric("平均捕获",summary.all.average_capture_pct===null?"—":pct(summary.all.average_capture_pct))}
        ${reviewMetric("平均持有",summary.all.average_held_days===null?"—":`${summary.all.average_held_days.toFixed(1)} 天`)}
        ${reviewMetric("平均 K×Q 年化",summary.all.average_rwa_apr_pct===null?"—":pct(summary.all.average_rwa_apr_pct))}
        ${reviewMetric("累计 P&L",signedMoney(summary.all.realized_pnl_total,2),"已扣已录入手续费")}
      </section>
      <section class="owner-review-groups">${reviewGroup("按资产",summary.by_asset)}${reviewGroup("按 70/25",summary.by_70_25)}${reviewGroup("按开仓 IV",summary.by_iv)}${reviewGroup("按平仓月份",summary.by_month)}</section>
      <section class="owner-review-filters" aria-label="复盘筛选"><label><span>月份</span><select id="ownerReviewMonth"><option value="all">全部</option>${months.map(month=>`<option value="${esc(month)}"${reviewFilters.month===month?" selected":""}>${esc(month)}</option>`).join("")}</select></label><label><span>资产</span><select id="ownerReviewAsset"><option value="all">全部</option>${OWNER_ASSETS.map(asset=>`<option value="${asset}"${reviewFilters.asset===asset?" selected":""}>${asset}</option>`).join("")}</select></label><label><span>平仓原因</span><select id="ownerReviewRule"><option value="all">全部</option>${Object.entries(Journal.EXIT_LABELS).map(([key,label])=>`<option value="${key}"${reviewFilters.rule===key?" selected":""}>${esc(label)}</option>`).join("")}</select></label><strong>${visible.length} / ${allRows.length} 笔</strong></section>
      <section class="owner-review-list">${visible.length?visible.map(reviewRowHtml).join(""):`<div class="owner-track-empty"><strong>没有匹配记录</strong><span>调整筛选，或先从持仓工作台确认平仓。</span></div>`}</section>`;
    const bindFilter=(id,key)=>$(id)?.addEventListener("change",event=>{reviewFilters[key]=event.target.value;renderOwnerReview()});
    bindFilter("ownerReviewMonth","month");bindFilter("ownerReviewAsset","asset");bindFilter("ownerReviewRule","rule");
    page.querySelectorAll("[data-owner-review-form]").forEach(form=>form.addEventListener("submit",saveOwnerReview));
  }

  async function saveOwnerReview(event){
    event.preventDefault();
    const form=event.currentTarget;
    const button=form.querySelector("button");
    const status=form.querySelector('[role="status"]');
    const repeat=form.elements.would_repeat.value;
    button.disabled=true;button.textContent="保存中…";status.textContent="";
    try{
      await rest("rpc/save_position_close_review",{method:"POST",body:{
        p_closed_position_id:form.dataset.ownerReviewForm,
        p_review_text:form.elements.review_text.value,
        p_would_repeat:repeat===""?null:repeat==="true",
      }});
      status.textContent="已保存";
      await loadPrivateData();
    }catch(error){status.textContent=error.message}
    finally{if(button.isConnected){button.disabled=false;button.textContent="保存复盘"}}
  }

  function installOwnerReviewUi(){
    const main=document.querySelector("main.wrap");
    if(!$("ownerReviewPage")){
      const page=document.createElement("section");
      page.id="ownerReviewPage";
      page.className="owner-review-page";
      main.appendChild(page);
    }
    renderOwnerReview();
  }

  function riskUnavailable(copy="报价缺失或过期"){
    return `<div class="owner-risk-empty"><strong>不可用</strong><span>${esc(copy)}</span></div>`;
  }

  function riskSignedUnits(value,asset){
    const number=Number(value);
    if(!Number.isFinite(number))return "不可用";
    return `${number>0?"+":""}${number.toLocaleString("en-US",{maximumFractionDigits:4})} ${asset}`;
  }

  function deltaLedgerHtml(ledger){
    if(!ledger.position_count)return riskUnavailable("无持仓");
    const rows=ledger.rows.map(row=>`<tr${row.available?"":' class="muted"'}><td><strong>${row.asset}</strong></td><td>${row.position_count}</td><td>${row.available?riskSignedUnits(row.equivalent_units,row.asset):"不可用"}</td><td>${row.available?signedMoney(row.equivalent_usd):"不可用"}</td><td>${row.available?signedPct(row.stablecoin_pct):"不可用"}</td></tr>`).join("");
    const totalUsd=ledger.available?signedMoney(ledger.equivalent_usd):"不可用";
    const totalPct=ledger.available?signedPct(ledger.stablecoin_pct):"不可用";
    const warning=ledger.unavailable_assets.length
      ?`<p class="owner-risk-warning">${ledger.unavailable_assets.join(" / ")} 报价不可用；合计停止计算，其他资产仍单独显示。</p>`:"";
    return `<div class="owner-risk-table"><table><thead><tr><th>资产</th><th>持仓数</th><th>Σ(Delta × 数量)</th><th>等效 USD</th><th>相对稳定币</th></tr></thead><tbody>${rows}<tr class="owner-risk-total"><td><strong>合计</strong></td><td>${ledger.position_count}</td><td>—</td><td>${totalUsd}</td><td>${totalPct}</td></tr></tbody></table></div>${warning}<p class="owner-risk-note">沿用期权链的 Put Delta 口径；负值表示链上 Put 对标的价格的负向敏感度。卖方持仓方向与合约多头方向相反。</p>`;
  }

  function expiryLadderHtml(ladder){
    if(!ladder.position_count)return riskUnavailable("无持仓");
    const max=Math.max(...ladder.rows.map(row=>row.total),1);
    const bars=ladder.rows.map(row=>{
      const height=Math.max(4,row.total/max*100);
      const segments=Portfolio.ASSETS.filter(asset=>row.by_asset[asset]>0).map(asset=>{
        const portion=row.by_asset[asset]/row.total*100;
        return `<i class="asset-${asset.toLowerCase()}" style="height:${portion.toFixed(3)}%" title="${asset} ${money(row.by_asset[asset])}"></i>`;
      }).join("");
      const concentration=row.portfolio_pct>30?' <em>集中</em>':"";
      return `<div class="owner-risk-bar-column"><span>${money(row.total)}</span><div class="owner-risk-bar" style="height:${height.toFixed(3)}%">${segments}</div><small>${esc(row.expiry)}${concentration}</small><b>${pct(row.portfolio_pct)}</b></div>`;
    }).join("");
    return `<div class="owner-risk-legend"><span class="asset-btc">BTC</span><span class="asset-eth">ETH</span><span class="asset-hype">HYPE</span></div><div class="owner-expiry-chart" role="img" aria-label="按到期日堆叠的完整 Strike 承诺">${bars}</div><p class="owner-risk-note">纵轴为当日到期持仓的完整 K×Q；“集中”仅表示该日超过全部承诺的 30%，不是自动交易结论。</p>`;
  }

  function strikeLadderHtml(ladders){
    if(!ladders.length)return riskUnavailable("无持仓");
    return `<div class="owner-strike-ladders">${ladders.map(ladder=>{
      const extent=[...ladder.rows.map(row=>row.strike),...(ladder.spot===null?[]:[ladder.spot])];
      const min=Math.min(...extent),max=Math.max(...extent);
      const span=Math.max(max-min,1);
      const maxCapital=Math.max(...ladder.rows.map(row=>row.capital),1);
      const spotLeft=ladder.spot===null?null:(ladder.spot-min)/span*100;
      const bars=ladder.rows.map(row=>{
        const left=(row.strike-min)/span*100;
        const height=Math.max(5,row.capital/maxCapital*100);
        return `<div class="owner-strike-bar ${row.moneyness}" style="left:${left.toFixed(3)}%;height:${height.toFixed(3)}%"><span>${money(row.capital)}</span><small>${money(row.strike)}</small></div>`;
      }).join("");
      return `<section class="owner-strike-card"><header><div><strong>${ladder.asset}</strong><span>${ladder.rows.length} 个 Strike · ${money(ladder.total)} K×Q</span></div><span>${ladder.spot_available?`Spot ${money(ladder.spot)}`:"Spot 不可用"}</span></header><div class="owner-strike-chart">${spotLeft===null?"":`<i class="owner-spot-line" style="left:${spotLeft.toFixed(3)}%"><b>SPOT</b></i>`}${bars}</div>${ladder.spot_available?"":'<p class="owner-risk-warning">现价过期，柱形仍显示但不判断 OTM / ITM。</p>'}</section>`;
    }).join("")}</div><p class="owner-risk-note">绿色为 Strike 低于新鲜 Spot；红色为 Strike 大于或等于 Spot。柱高表示该 Strike 的 K×Q。</p>`;
  }

  function stressChartSvg(points){
    if(!points.length)return "";
    const values=points.map(point=>point.total_pnl??point.known_total_pnl);
    let min=Math.min(...values),max=Math.max(...values);
    if(min===max){min-=1;max+=1}
    const width=800,height=230,padX=42,padY=28;
    const range=Math.max(Math.abs(points[0].shock_pct),Math.abs(points.at(-1).shock_pct),1);
    const x=value=>padX+(value+range)/(2*range)*(width-padX*2);
    const y=value=>padY+(max-value)/(max-min)*(height-padY*2);
    const coordinates=points.map(point=>`${x(point.shock_pct).toFixed(1)},${y(point.total_pnl??point.known_total_pnl).toFixed(1)}`).join(" ");
    const zeroY=min<=0&&max>=0?y(0):null;
    return `<svg class="owner-stress-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="跨资产压力路径损益折线图">${zeroY===null?"":`<line class="zero" x1="${padX}" x2="${width-padX}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"/>`}<polyline points="${coordinates}"/>${points.map(point=>`<circle cx="${x(point.shock_pct).toFixed(1)}" cy="${y(point.total_pnl??point.known_total_pnl).toFixed(1)}" r="4"><title>${signedPct(point.shock_pct)} · ${signedMoney(point.total_pnl??point.known_total_pnl)}</title></circle>`).join("")}<text x="${padX}" y="${height-5}">-${range}%</text><text x="${width-padX}" y="${height-5}" text-anchor="end">+${range}%</text></svg>`;
  }

  function stressPortfolioHtml(stress){
    if(!stress.position_count)return riskUnavailable("无持仓");
    const worst=stress.worst_point;
    const rows=(worst?.by_asset||[]).map(row=>`<tr${row.available?"":' class="muted"'}><td><strong>${row.asset}</strong></td><td>${row.available?signedMoney(row.pnl):"不可用"}</td></tr>`).join("");
    const unavailable=worst?.unavailable_assets||[];
    return `<div class="owner-portfolio-stress-controls"><label><span>BTC / ETH / HYPE 同步涨跌范围</span><strong>±${portfolioStressRange.toFixed(1)}%</strong></label><input id="ownerPortfolioStressRange" type="range" min="1" max="100" step="0.1" value="${portfolioStressRange.toFixed(1)}"><label class="owner-stress-number"><input id="ownerPortfolioStressNumber" type="number" min="1" max="100" step="0.1" value="${portfolioStressRange.toFixed(1)}" inputmode="decimal"><span>%</span></label></div>${stressChartSvg(stress.points)}<div class="owner-risk-table owner-stress-summary"><table><thead><tr><th>最差路径 ${worst?signedPct(worst.shock_pct):"—"}</th><th>损益</th></tr></thead><tbody>${rows}<tr class="owner-risk-total"><td><strong>${unavailable.length?"已知部分":"全组合"}</strong></td><td>${worst?signedMoney(worst.total_pnl??worst.known_total_pnl):"不可用"}</td></tr></tbody></table></div>${unavailable.length?`<p class="owner-risk-warning">${unavailable.join(" / ")} 缺少新鲜报价或 IV；折线只表示其余已知资产，不能当作全组合损益。</p>`:""}${worst?.worst_position?`<p class="owner-risk-note">最差单笔：${esc(worst.worst_position.asset)} · ${signedMoney(worst.worst_position.pnl)}。假设 IV 与剩余期限不变，按 Black–Scholes 重算，不含手续费、滑点或保证金变化。</p>`:""}`;
  }

  function renderOwnerPortfolio(){
    if(!portfolioRoute)return;
    const page=$("ownerPortfolioPage");
    if(!page)return;
    if(!privateReady){
      page.innerHTML=`<div class="owner-private-error">${esc(privateError||"正在读取私有组合数据…")}</div>`;
      return;
    }
    const now=Date.now();
    const delta=Portfolio.deltaLedger(ownerState,positions,researchByAsset,now);
    const expiry=Portfolio.expiryLadder(positions);
    const strikes=Portfolio.strikeLadders(positions,researchByAsset,now);
    const stress=Portfolio.stressPortfolio(positions,researchByAsset,portfolioStressRange,now);
    const panel=(id,title,copy,body)=>`<section class="owner-risk-panel${portfolioTab===id?" active":""}" data-owner-risk-panel="${id}"><header><span class="owner-kicker">${id.toUpperCase()}</span><h3>${title}</h3><p>${copy}</p></header>${body}</section>`;
    page.innerHTML=`<header class="owner-review-head owner-portfolio-head"><div><span class="owner-kicker">PORTFOLIO RISK LEDGER</span><h2>组合风险总账</h2><p>只读组合视角；不改变单笔仓位的平仓规则，也不生成调仓建议。</p></div><button type="button" class="owner-quiet" id="ownerPortfolioRefresh"${researchLoading?" disabled":""}>${researchLoading?"刷新中…":"刷新报价"}</button></header><nav class="owner-risk-tabs" aria-label="组合风险视图">${[["delta","Delta 总账"],["expiry","到期阶梯"],["strike","Strike 阶梯"],["stress","联合压力"]].map(([id,label])=>`<button type="button" data-owner-risk-tab="${id}" class="${portfolioTab===id?"active":""}">${label}</button>`).join("")}</nav><div class="owner-risk-panels">${panel("delta","Delta 敞口总账","按资产汇总链上 Put Delta × 名义数量。",deltaLedgerHtml(delta))}${panel("expiry","到期日阶梯","按到期日堆叠完整 Strike 承诺。",expiryLadderHtml(expiry))}${panel("strike","Strike 阶梯","查看每种资产的承诺落在哪些行权价。",strikeLadderHtml(strikes))}${panel("stress","跨资产联合压力","假设三种资产同时涨跌、IV 不变，重算组合路径。",stressPortfolioHtml(stress))}</div>`;
    $("ownerPortfolioRefresh")?.addEventListener("click",refreshAll);
    page.querySelectorAll("[data-owner-risk-tab]").forEach(button=>button.addEventListener("click",()=>{portfolioTab=button.dataset.ownerRiskTab;renderOwnerPortfolio()}));
    $("ownerPortfolioStressRange")?.addEventListener("input",event=>{portfolioStressRange=Portfolio.normalizeRange(event.target.value);renderOwnerPortfolio()});
    $("ownerPortfolioStressNumber")?.addEventListener("change",event=>{portfolioStressRange=Portfolio.normalizeRange(event.target.value);renderOwnerPortfolio()});
  }

  function installOwnerPortfolioUi(){
    const main=document.querySelector("main.wrap");
    if(!$("ownerPortfolioPage")){
      const page=document.createElement("section");
      page.id="ownerPortfolioPage";
      page.className="owner-portfolio-page";
      main.appendChild(page);
    }
    renderOwnerPortfolio();
  }

  function scenarioInput(label,key,value,minimum,maximum,step,suffix){
    return `<section class="owner-scenario-control"><label><span>${esc(label)}</span><strong>${Number(value)>0?"+":""}${Number(value).toFixed(step<1?1:0)}${suffix}</strong></label><input type="range" min="${minimum}" max="${maximum}" step="${step}" value="${value}" data-scenario-field="${key}"><input type="number" min="${minimum}" max="${maximum}" step="${step}" value="${value}" inputmode="decimal" data-scenario-field="${key}"></section>`;
  }

  function drawScenarioHeatmap(map){
    const canvas=$("ownerScenarioHeatmap");
    if(!canvas||!map?.cells?.length)return;
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const cssWidth=Math.max(620,canvas.parentElement.clientWidth||620);
    const cssHeight=380;
    canvas.style.width=`${cssWidth}px`;
    canvas.style.height=`${cssHeight}px`;
    canvas.width=Math.round(cssWidth*ratio);
    canvas.height=Math.round(cssHeight*ratio);
    const context=canvas.getContext("2d");
    context.scale(ratio,ratio);
    const left=58,top=24,right=18,bottom=44;
    const columns=map.price_shocks.length,rows=map.iv_shocks.length;
    const cellWidth=(cssWidth-left-right)/columns;
    const cellHeight=(cssHeight-top-bottom)/rows;
    const maximum=Math.max(1,...map.cells.map(cell=>Math.abs(cell.change||0)));
    context.font='11px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign="center";
    context.textBaseline="middle";
    map.cells.forEach((cell,index)=>{
      const column=index%columns,row=Math.floor(index/columns);
      const intensity=Math.min(1,Math.abs(cell.change||0)/maximum);
      const positive=(cell.change||0)>=0;
      context.fillStyle=positive?`rgba(47,179,168,${.12+intensity*.68})`:`rgba(255,107,107,${.12+intensity*.68})`;
      context.fillRect(left+column*cellWidth,top+row*cellHeight,cellWidth-1,cellHeight-1);
      context.fillStyle="#e5e7eb";
      context.fillText(signedMoney(cell.change,0),left+(column+.5)*cellWidth,top+(row+.5)*cellHeight);
    });
    context.fillStyle="#8b93a5";
    map.price_shocks.forEach((value,index)=>context.fillText(`${value>0?"+":""}${value}%`,left+(index+.5)*cellWidth,cssHeight-bottom+17));
    context.textAlign="right";
    map.iv_shocks.forEach((value,index)=>context.fillText(`${value>0?"+":""}${value}pt`,left-8,top+(index+.5)*cellHeight));
    context.textAlign="center";
    context.fillText("标的价格变化",left+(cssWidth-left-right)/2,cssHeight-8);
    context.save();context.translate(11,top+(cssHeight-top-bottom)/2);context.rotate(-Math.PI/2);context.fillText("IV 变化",0,0);context.restore();
  }

  function scheduleScenarioRender(){
    clearTimeout(scenarioRenderTimer);
    scenarioRenderTimer=setTimeout(renderOwnerScenario,100);
  }

  function renderOwnerScenario(){
    if(!scenarioRoute)return;
    const page=$("ownerScenarioPage");
    if(!page)return;
    if(!privateReady){
      page.innerHTML=`<div class="owner-private-error">${esc(privateError||"正在读取私有持仓与期权链…")}</div>`;
      return;
    }
    const now=Date.now();
    const result=Scenario.portfolioScenario(positions,researchByAsset,scenarioValue,now);
    const presets=Object.entries(Scenario.PRESETS).map(([key,row])=>`<button type="button" data-scenario-preset="${key}">${esc(row.label)}</button>`).join("");
    if(!positions.length){
      page.innerHTML=`<header class="owner-review-head"><div><span class="owner-kicker">SCENARIO LAB</span><h2>组合情景压力</h2><p>同时调整价格、IV 与经过时间，按 Black–Scholes 重算现有 Sell Put。</p></div><a class="owner-quiet" href="${ownerBase}">返回持仓</a></header><div class="owner-risk-empty"><strong>暂无持仓</strong><span>录入 Sell Put 后才会生成压力结果。</span></div>`;
      return;
    }
    const rowHtml=result.rows.map(row=>{
      const position=positions.find(item=>String(item.id)===String(row.id));
      const label=`${row.asset||position?.asset||"—"} ${money(position?.strike)} Put`;
      return row.available
        ?`<tr><td><strong>${label}</strong><small>${esc(position?.expiry||"")}</small></td><td>${signedMoney(row.current_pnl)}</td><td>${signedMoney(row.scenario_pnl)}</td><td class="${row.change<0?"bad":"good"}">${signedMoney(row.change)}</td></tr>`
        :`<tr class="unavailable"><td><strong>${label}</strong><small>${esc(position?.expiry||"")}</small></td><td colspan="3">不可用 · ${esc(row.reason)}</td></tr>`;
    }).join("");
    const worst=result.worst?`${result.worst.asset} ${signedMoney(result.worst.change)}`:"—";
    const best=result.best?`${result.best.asset} ${signedMoney(result.best.change)}`:"—";
    page.innerHTML=`<header class="owner-review-head"><div><span class="owner-kicker">SCENARIO LAB</span><h2>组合情景压力</h2><p>价格、IV 与时间三维重估；只显示模型结果，不生成调仓、对冲或下单建议。</p></div><button type="button" class="owner-quiet" id="ownerScenarioRefresh"${researchLoading?" disabled":""}>${researchLoading?"刷新中…":"刷新报价"}</button></header>
      <div class="owner-scenario-controls">${scenarioInput("标的价格", "price_shock_pct",result.scenario.price_shock_pct,-50,50,.1,"%")}${scenarioInput("IV", "iv_shock_points",result.scenario.iv_shock_points,-30,30,.1," pt")}${scenarioInput("经过时间", "time_days",result.scenario.time_days,0,30,1," 天")}</div>
      <div class="owner-scenario-presets" aria-label="压力预设">${presets}</div>
      <section class="owner-scenario-summary"><div><span>当前模型 P&amp;L</span><strong>${signedMoney(result.current_pnl)}</strong><small>${result.available_count} 笔可用</small></div><div><span>情景 P&amp;L</span><strong>${signedMoney(result.scenario_pnl)}</strong><small>相对开仓权利金</small></div><div><span>组合变化</span><strong class="${result.change<0?"bad":"good"}">${signedMoney(result.change)}</strong><small>${result.unavailable_count?`${result.unavailable_count} 笔未纳入`:"全部仓位已纳入"}</small></div><div><span>最差 / 最好单笔</span><strong>${esc(worst)}</strong><small>${esc(best)}</small></div></section>
      <div class="owner-scenario-grid"><section class="owner-scenario-panel"><header><h3>逐仓重估</h3><p>当前 P&amp;L → 情景 P&amp;L → 变化</p></header><div class="owner-risk-table"><table class="owner-scenario-table"><thead><tr><th>仓位</th><th>当前</th><th>情景</th><th>变化</th></tr></thead><tbody>${rowHtml}</tbody></table></div><p class="owner-scenario-note">IV 被限制在 1%–500%；到期后的期权按内在价值处理。缺少新鲜报价、IV 或任一 Greek 的仓位不参与汇总。</p></section><section class="owner-scenario-panel"><header><h3>价格 × IV 热力图</h3><p>固定经过 ${result.scenario.time_days} 天；格内为相对当前模型 P&amp;L 的变化</p></header><div style="overflow-x:auto"><canvas class="owner-scenario-heatmap" id="ownerScenarioHeatmap" role="img" aria-label="价格与 IV 组合压力热力图"></canvas></div></section></div>`;
    $("ownerScenarioRefresh")?.addEventListener("click",refreshAll);
    page.querySelectorAll("[data-scenario-field]").forEach(input=>input.addEventListener("input",event=>{
      const key=event.target.dataset.scenarioField;
      scenarioValue=Scenario.normalizeScenario({...scenarioValue,[key]:event.target.value});
      scheduleScenarioRender();
    }));
    page.querySelectorAll("[data-scenario-preset]").forEach(button=>button.addEventListener("click",()=>{
      scenarioValue=Scenario.normalizeScenario(Scenario.PRESETS[button.dataset.scenarioPreset]);
      renderOwnerScenario();
    }));
    if(result.available_count)requestAnimationFrame(()=>drawScenarioHeatmap(Scenario.heatmap(positions,researchByAsset,result.scenario.time_days,now)));
  }

  function installOwnerScenarioUi(){
    const main=document.querySelector("main.wrap");
    if(!$("ownerScenarioPage")){
      const page=document.createElement("section");
      page.id="ownerScenarioPage";
      page.className="owner-scenario-page";
      main.appendChild(page);
    }
    renderOwnerScenario();
  }

  function shareApiUrl(path=""){
    return `${supabaseUrl}/functions/v1/share-api${path}`;
  }

  async function ownerShareRequest(path="",options={}){
    await ensureSession();
    const headers=new Headers(options.headers||{});
    headers.set("apikey",anonKey);
    headers.set("authorization",`Bearer ${session.access_token}`);
    if(options.body)headers.set("content-type","application/json");
    let response=await fetch(shareApiUrl(path),{...options,headers,cache:"no-store"});
    if(response.status===401){
      await refreshSession({force:true});
      headers.set("authorization",`Bearer ${session.access_token}`);
      response=await fetch(shareApiUrl(path),{...options,headers,cache:"no-store"});
    }
    let payload={};try{payload=await response.json()}catch(_){ }
    if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    return payload;
  }

  function shareKindLabel(kind){
    return ({track_record:"Track record",current_positions:"当前持仓快照",strategy_summary:"策略规则摘要"})[kind]||kind;
  }

  function renderOwnerShare(){
    if(!shareRoute)return;
    const page=$("ownerSharePage");
    if(!page)return;
    const rows=shareLinks.map(link=>{
      const revoked=Boolean(link.revoked_at);
      const expired=Date.parse(link.expires_at)<=Date.now();
      const state=revoked?"已撤销":expired?"已过期":"有效";
      return `<article class="owner-share-row ${revoked||expired?"inactive":""}"><div><span>${esc(shareKindLabel(link.kind))}</span><strong>${esc(String(link.token).slice(0,8))}…</strong><small>${link.password_required?"密码保护 · ":""}${state} · ${utcDateTime(link.expires_at)}</small></div><div><span>访问</span><strong>${Number(link.access_count||0)} 次</strong><small>${link.last_accessed_at?`最后 ${utcDateTime(link.last_accessed_at)}`:"尚未访问"}</small></div><div class="owner-share-actions"><button type="button" class="owner-quiet" data-share-copy="${esc(link.url)}"${revoked||expired?" disabled":""}>复制链接</button><button type="button" class="owner-danger" data-share-revoke="${esc(link.token)}"${revoked?" disabled":""}>撤销</button></div></article>`;
    }).join("");
    page.innerHTML=`<header class="owner-review-head"><div><span class="owner-kicker">READ-ONLY SHARE</span><h2>分享策略快照</h2><p>创建时冻结内容；最长 30 天。公开页面永远不包含账户余额、available、名义数量、K×Q 金额或邮箱。</p></div><button type="button" class="owner-quiet" id="ownerShareReload"${shareLoading?" disabled":""}>${shareLoading?"读取中…":"刷新列表"}</button></header>
      <section class="owner-share-create"><h3>新建分享</h3><form id="ownerShareForm"><label><span>分享内容</span><select name="kind"><option value="track_record">Track record</option><option value="current_positions">当前持仓快照</option><option value="strategy_summary">策略规则摘要</option></select></label><label><span>有效期</span><select name="days"><option value="1">1 天</option><option value="7" selected>7 天</option><option value="30">30 天</option></select></label><label class="owner-share-password-toggle"><input name="password_enabled" type="checkbox"><span>使用 4–8 位数字密码</span></label><label class="owner-share-password" hidden><span>访问密码</span><input name="password" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="new-password"></label><button type="submit" class="owner-primary"${localPreview?" disabled":""}>生成只读链接</button></form><p class="owner-share-error" id="ownerShareError">${esc(localPreview?"本地预览不会创建或修改生产分享链接。":shareError)}</p></section>
      <section class="owner-share-list"><header><h3>已创建的链接</h3><span>${shareLinks.length} 条</span></header>${rows||'<div class="owner-risk-empty"><strong>还没有分享链接</strong><span>创建后可复制给指定访客，也可以随时撤销。</span></div>'}</section>`;
    $("ownerShareReload")?.addEventListener("click",loadOwnerShares);
    const form=$("ownerShareForm");
    const toggle=form.elements.password_enabled;
    const passwordLabel=form.querySelector(".owner-share-password");
    toggle.addEventListener("change",()=>{passwordLabel.hidden=!toggle.checked;form.elements.password.required=toggle.checked;if(!toggle.checked)form.elements.password.value=""});
    form.addEventListener("submit",createOwnerShare);
    page.querySelectorAll("[data-share-copy]").forEach(button=>button.addEventListener("click",async()=>{
      try{await navigator.clipboard.writeText(button.dataset.shareCopy);button.textContent="已复制"}catch(_){prompt("复制这个只读链接：",button.dataset.shareCopy)}
    }));
    page.querySelectorAll("[data-share-revoke]").forEach(button=>button.addEventListener("click",()=>revokeOwnerShare(button.dataset.shareRevoke)));
  }

  async function loadOwnerShares(){
    if(!shareRoute||shareLoading||localPreview)return;
    shareLoading=true;shareError="";renderOwnerShare();
    try{const payload=await ownerShareRequest("/api/share-links");shareLinks=Array.isArray(payload.links)?payload.links:[]}
    catch(error){shareError=error.message||"分享链接读取失败"}
    finally{shareLoading=false;renderOwnerShare()}
  }

  async function createOwnerShare(event){
    event.preventDefault();
    if(localPreview)return;
    const form=event.currentTarget;
    const error=$("ownerShareError");
    if(!form.reportValidity())return;
    const button=form.querySelector('[type="submit"]');
    button.disabled=true;button.textContent="生成中…";error.textContent="";
    try{
      const payload=await ownerShareRequest("/api/share-links",{method:"POST",body:JSON.stringify({kind:form.elements.kind.value,days:Number(form.elements.days.value),password:form.elements.password_enabled.checked?form.elements.password.value:null})});
      shareLinks.unshift({...payload,access_count:0,last_accessed_at:null,created_at:new Date().toISOString(),revoked_at:null});
      renderOwnerShare();
      const created=$("ownerShareError");created.classList.add("ok");created.textContent="链接已生成；复制后请只发给预期访客。";
    }catch(errorValue){error.textContent=errorValue.message||"创建失败";button.disabled=false;button.textContent="生成只读链接"}
  }

  async function revokeOwnerShare(token){
    if(!token||localPreview||!confirm("撤销后，访客会立即看到链接已失效。确认撤销？"))return;
    try{await ownerShareRequest(`/api/share-links/${encodeURIComponent(token)}`,{method:"DELETE"});const row=shareLinks.find(item=>item.token===token);if(row)row.revoked_at=new Date().toISOString();renderOwnerShare()}
    catch(error){shareError=error.message||"撤销失败";renderOwnerShare()}
  }

  function installOwnerShareUi(){
    const main=document.querySelector("main.wrap");
    if(!$("ownerSharePage")){
      const page=document.createElement("section");
      page.id="ownerSharePage";
      page.className="owner-share-page";
      main.appendChild(page);
    }
    renderOwnerShare();
  }

  function installOwnerUi(){
    configureNavigation();
    if(rankingsRoute){
      installOwnerRankingsUi();
      return;
    }
    if(reviewRoute){
      installOwnerReviewUi();
      return;
    }
    if(portfolioRoute){
      installOwnerPortfolioUi();
      return;
    }
    if(scenarioRoute){
      installOwnerScenarioUi();
      return;
    }
    if(shareRoute){
      installOwnerShareUi();
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
    const openSnapshot=snapshotForPosition(positionValue.id);
    const venue=Journal.VENUE_LABELS[openSnapshot?.venue]||"Deribit";
    const editAction=openSnapshot
      ?'<button type="button" class="owner-quiet" disabled title="开仓快照已锁定；如录入有误，请删除后重新录入">快照已锁定</button>'
      :`<button type="button" class="owner-quiet" data-owner-edit="${esc(positionValue.id)}"${privateReady?"":" disabled"}>编辑持仓</button>`;
    const unavailable=quoteUnavailableReason(positionValue,metrics);
    const spread=metrics.spread_pct===null?"—":pct(metrics.spread_pct);
    const holdingAprUsable=metrics.quote_usable&&metrics.remaining_apr!==null;
    const aprClass=!holdingAprUsable?"muted":metrics.remaining_apr<metrics.exit_apr_threshold?"bad":"good";
    const pnlClass=metrics.quote_usable&&metrics.unrealized_pnl>0
      ?"good":metrics.quote_usable&&metrics.unrealized_pnl<0?"bad":"muted";
    return `<div class="owner-position-detail">
      <div class="owner-inspector-head"><div><span class="owner-kicker">SELECTED POSITION</span><h3>${positionValue.asset} ${money(positionValue.strike)} Put</h3><p>${esc(venue)} · ${esc(positionValue.expiry)} · ${positionValue.notional_btc.toLocaleString()} ${positionValue.asset}</p></div><span class="owner-status ${statusClass(decision.state)}">${esc(decision.verdict)}</span></div>
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
      <div class="owner-secondary-actions"><button type="button" class="owner-primary owner-close-action" data-owner-close="${esc(positionValue.id)}"${privateReady?"":" disabled"}>平仓</button>${editAction}<button type="button" class="owner-quiet bad" data-owner-delete="${esc(positionValue.id)}"${privateReady?"":" disabled"}>删除持仓</button></div>
      <details class="owner-research-card" open><summary><span>高级研究 / CVaR / 压力测试</span><span>可调压力区间</span></summary>${researchCard(positionValue)}</details>
    </div>`;
  }

  function positionRow(row){
    const {position:positionValue,decision,metrics}=row;
    const venue=Journal.VENUE_LABELS[snapshotForPosition(positionValue.id)?.venue]||"Deribit";
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
      <span class="owner-position-contract"><strong>${positionValue.asset} ${money(positionValue.strike)} Put</strong><small>${esc(venue)} · ${esc(positionValue.expiry)} · ${positionValue.notional_btc.toLocaleString()} ${positionValue.asset}</small></span>
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
    page.querySelectorAll("[data-owner-close]").forEach(button=>button.addEventListener("click",()=>{
      openClosedRecordDialog(null,positions.find(row=>row.id===button.dataset.ownerClose));
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
      <label><span>交易平台</span><select id="ownerPositionVenue" required><option value="binance">Binance</option><option value="okx">OKX</option><option value="deribit" selected>Deribit</option></select></label>
      <label><span>行权价</span><input id="ownerPositionStrike" type="number" min="0" step="any" inputmode="decimal" placeholder="例如 60000" required></label>
      <label><span>到期日</span><input id="ownerPositionExpiry" type="date" required></label>
      <label><span id="ownerPositionNotionalLabel">BTC 名义数量</span><input id="ownerPositionNotional" type="number" min="0.01" step="any" inputmode="decimal" value="1" required></label>
      <label><span id="ownerPositionPremiumLabel">开仓权利金 / 1 BTC</span><input id="ownerPositionPremium" type="number" min="0" step="any" inputmode="decimal" placeholder="每 BTC 收到的权利金" required></label>
      <label><span>开仓日期</span><input id="ownerPositionOpenDate" type="date" required></label>
      <label><span>开仓时间</span><input id="ownerPositionOpenTime" type="time" step="60" required><small>按成交记录填写，精确到分钟</small></label>
      <section class="owner-open-context owner-form-wide" id="ownerOpenContext" aria-live="polite"><div><span>开仓市场环境</span><strong>填写日期和时间后自动回填</strong></div><small>只回填可验证的市场数据；历史 Bid / Ask / Greeks 不会伪造。</small></section>
      <details class="owner-reason-field owner-form-wide" open><summary>开仓理由（给半年后的自己看）</summary><label><span>当时为什么决定开这笔仓位？</span><textarea id="ownerPositionReason" maxlength="1000" rows="4" placeholder="记录当时的市场判断、触发条件与担忧。"></textarea></label></details>
    </div><p class="owner-form-note" id="ownerPositionNote">Deribit · 资本占用按行权价 × 名义数量</p><div class="owner-dialog-error" id="ownerDialogError" role="alert"></div><div class="owner-dialog-actions"><button type="button" class="owner-quiet" id="ownerDialogCancel">取消</button><button type="submit" class="owner-primary" id="ownerDialogSave">添加持仓</button></div></form></dialog>`;
  }

  function updatePositionAssetUi({resetNotional=false}={}){
    const asset=Strategy.normalizeAsset($("ownerPositionAsset").value);
    const defaults=ASSET_DEFAULTS[asset];
    $("ownerPositionNotionalLabel").textContent=`${asset} 名义数量`;
    $("ownerPositionPremiumLabel").textContent=`开仓权利金 / 1 ${asset}`;
    $("ownerPositionNotional").min=String(defaults.min);
    if(resetNotional)$("ownerPositionNotional").value=String(defaults.notional);
    const venue=Journal.normalizeVenue($("ownerPositionVenue").value);
    $("ownerPositionNote").textContent=`${Journal.VENUE_LABELS[venue]} · ${asset} Sell Put · 资本占用按行权价 × 名义数量`;
  }

  function bindPositionDialog(){
    $("ownerDialogClose").addEventListener("click",closePositionDialog);
    $("ownerDialogCancel").addEventListener("click",closePositionDialog);
    $("ownerPositionAsset").addEventListener("change",()=>{
      updatePositionAssetUi({resetNotional:true});
      localStorage.setItem(DRAFT_KEY,JSON.stringify(positionDraft()));
      scheduleOpenContext();
    });
    $("ownerPositionVenue").addEventListener("change",()=>{
      updatePositionAssetUi();
      localStorage.setItem(DRAFT_KEY,JSON.stringify(positionDraft()));
    });
    $("ownerPositionForm").addEventListener("submit",event=>{
      event.preventDefault();
      savePosition();
    });
    $("ownerPositionForm").addEventListener("input",()=>{
      localStorage.setItem(DRAFT_KEY,JSON.stringify(positionDraft()));
    });
    $("ownerPositionOpenDate").addEventListener("change",scheduleOpenContext);
    $("ownerPositionOpenTime").addEventListener("change",scheduleOpenContext);
  }

  function today(){return new Date().toISOString().slice(0,10)}

  function positionDraft(){
    return {
      id:$("ownerPositionId").value||"draft",
      asset:$("ownerPositionAsset").value,kind:"sell_put",
      venue:$("ownerPositionVenue").value,
      strike:$("ownerPositionStrike").value,
      expiry:$("ownerPositionExpiry").value,
      notional_btc:$("ownerPositionNotional").value,
      open_premium_per_btc:$("ownerPositionPremium").value,
      open_date:$("ownerPositionOpenDate").value,
      open_time:$("ownerPositionOpenTime").value,
      reason_text:$("ownerPositionReason").value,
    };
  }

  function optionsApiBase(){
    const fallback=`${supabaseUrl}/functions/v1/options-api`;
    return String(
      window.MANGO_API_BASE!==undefined
        ?window.MANGO_API_BASE
        :(["localhost","127.0.0.1"].includes(location.hostname)?"":fallback)
    ).replace(/\/+$/g,"");
  }

  function openContextUrl(asset,opening){
    const params=new URLSearchParams({
      asset,at:opening.requested_at,precision:opening.precision,
    });
    return `${optionsApiBase()}/api/owner/open-context?${params}`;
  }

  function contextDisplayHtml(context,opening){
    if(!context)return `<div><span>开仓市场环境</span><strong>填写日期和时间后自动回填</strong></div><small>只回填可验证的市场数据；历史 Bid / Ask / Greeks 不会伪造。</small>`;
    const quality=Journal.CONTEXT_LABELS[context.capture_method]||"不可恢复";
    const regime=context.market_regime?.label||"市场状态数据不足";
    const contextIv=context.dvol_pct??context.implied_vol_pct;
    const warning=Array.isArray(context.warnings)&&context.warnings.length
      ?context.warnings.join("；"):"数据按开仓时点截断，不使用未来信息。";
    return `<div class="owner-open-context-head"><span>开仓市场环境</span><strong>${esc(quality)} · ${opening.precision==="minute"?"分钟级":"日级"}</strong></div>
      <div class="owner-open-context-metrics"><span>Spot <b>${money(context.spot_usd,2)}</b></span><span>7D <b>${signedPct(context.price_change_7d_pct)}</b></span><span>30D <b>${signedPct(context.price_change_30d_pct)}</b></span><span>RV <b>${pct(context.realized_vol_pct)}</b></span><span>DVOL / IV <b>${pct(contextIv)}</b></span><span>IV 分位 <b>${pct(context.iv_percentile_pct)}</b></span><span>VRP <b>${context.vrp_pct==null?"—":`${Number(context.vrp_pct).toFixed(1)} pp`}</b></span><span>F&amp;G <b>${context.fear_greed==null?"—":Number(context.fear_greed).toFixed(0)}</b></span></div>
      <p>${esc(regime)}</p><small>${esc(warning)}</small>`;
  }

  function unavailableOpenContext(opening,message){
    return {
      requested_at:opening.requested_at,context_asof_at:null,
      capture_method:"unavailable",requested_precision:opening.precision,
      effective_precision:opening.precision,coverage:"unavailable",source:"unavailable",
      market_regime:{code:"unknown",label:"市场环境不可恢复"},
      warnings:[String(message||"历史市场数据暂不可用")],
    };
  }

  function renderOpenContext(context=null,opening=null,{loading=false}={}){
    const node=$("ownerOpenContext");
    if(!node||node.hidden)return;
    if(loading){
      node.innerHTML=`<div><span>开仓市场环境</span><strong>正在回填…</strong></div><small>按开仓时点读取历史数据。</small>`;
      return;
    }
    node.innerHTML=contextDisplayHtml(context,opening||{precision:"daily"});
  }

  async function loadOpenContext({force=false}={}){
    const draft=positionDraft();
    const opening=Journal.openingRequest({openDate:draft.open_date,openTime:draft.open_time});
    const key=`${draft.asset}:${opening.requested_at}:${opening.precision}`;
    if(!force&&openContextValue&&openContextKey===key)return {opening,context:openContextValue};
    openContextController?.abort();
    openContextController=new AbortController();
    const version=++openContextVersion;
    openContextKey=key;
    renderOpenContext(null,opening,{loading:true});
    try{
      await ensureSession();
      const response=await authorizedFetch(openContextUrl(draft.asset,opening),{
        signal:openContextController.signal,cache:"no-store",
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      if(version!==openContextVersion)throw new DOMException("stale","AbortError");
      openContextValue=payload;
    }catch(error){
      if(error.name==="AbortError")throw error;
      openContextValue=unavailableOpenContext(opening,error.message);
    }
    if(version===openContextVersion)renderOpenContext(openContextValue,opening);
    return {opening,context:openContextValue};
  }

  function scheduleOpenContext(){
    clearTimeout(openContextTimer);
    openContextValue=null;
    openContextKey="";
    openContextTimer=setTimeout(()=>loadOpenContext().catch(error=>{
      if(error.name!=="AbortError")renderOpenContext();
    }),350);
  }

  function openPositionDialog(existing=null,prefill=null){
    if(existing&&snapshotForPosition(existing.id)){
      setNotice("这笔持仓已有不可变开仓快照；如录入有误，请删除后重新录入。","warn");
      return;
    }
    const draft=!existing&&!prefill?readStoredJson(DRAFT_KEY):null;
    const row=existing||prefill||draft||{};
    const asset=Strategy.normalizeAsset(row.asset||currentMarketAsset());
    const existingSnapshot=existing?snapshotForPosition(existing.id):null;
    $("ownerDialogTitle").textContent=existing?"编辑 Sell Put 持仓":"新增 Sell Put 持仓";
    $("ownerDialogSave").textContent=existing?"保存修改":"添加持仓";
    $("ownerPositionId").value=existing?.id||"";
    $("ownerPositionAsset").value=asset;
    $("ownerPositionAsset").disabled=Boolean(existing);
    $("ownerPositionVenue").value=Journal.normalizeVenue(existingSnapshot?.venue||row.venue||"deribit");
    $("ownerPositionVenue").disabled=Boolean(existing);
    $("ownerPositionStrike").value=inputValue(row.strike);
    $("ownerPositionExpiry").value=row.expiry||"";
    $("ownerPositionNotional").value=inputValue(
      row.notional_btc??row.min_trade_amount??ASSET_DEFAULTS[asset].notional,
    );
    $("ownerPositionPremium").value=inputValue(row.open_premium_per_btc??row.bid_usd??0);
    $("ownerPositionOpenDate").value=row.open_date||today();
    $("ownerPositionOpenTime").value=row.open_time||"";
    $("ownerPositionReason").value=existingSnapshot?.reason_text||row.reason_text||"";
    $("ownerPositionReason").readOnly=Boolean(existing);
    $("ownerOpenContext").hidden=Boolean(existing);
    openContextValue=null;
    openContextKey="";
    updatePositionAssetUi();
    $("ownerDialogError").textContent="";
    const dialog=$("ownerPositionDialog");
    if(dialog.showModal)dialog.showModal();
    else dialog.setAttribute("open","");
    if(!existing)scheduleOpenContext();
  }

  function closePositionDialog(){
    clearTimeout(openContextTimer);
    openContextController?.abort();
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
      let rows;
      if(id){
        rows=await rest(`positions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${session.user.id}`,{
          method:"PATCH",body,prefer:"return=representation",
        });
      }else{
        const {opening,context}=await loadOpenContext({force:true});
        const research=researchFor(normalized.asset);
        const dashboardState=window.MangoDashboard?.getState?.()||{};
        const timing=String(dashboardState.asset||"").toUpperCase()===normalized.asset
          ?dashboardState.timing:null;
        const available=Strategy.portfolioSummary(ownerState,positions,researchByAsset).available;
        const snapshot=Journal.buildOpenSnapshot({
          position:normalized,research,timing,availableBefore:available,
          reasonText:draft.reason_text,venue:draft.venue,
          openedAt:opening.opened_at,openPrecision:opening.precision,
          historicalContext:context,
        });
        rows=await rest("rpc/create_position_with_snapshot",{
          method:"POST",body:{p_position:body,p_snapshot:snapshot},
        });
      }
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
    return `<dialog id="ownerClosedDialog" class="owner-dialog owner-entry-dialog owner-closed-dialog" role="dialog" aria-modal="true" aria-labelledby="ownerClosedTitle"><form id="ownerClosedForm" method="dialog"><div class="owner-dialog-head"><div><span class="owner-kicker">TRACK RECORD</span><h2 id="ownerClosedTitle">录入平仓记录</h2><p class="owner-dialog-subtitle" id="ownerClosedSubtitle">只记录已确认的实现结果，不读取交易所数据。</p></div><button type="button" class="owner-dialog-close" id="ownerClosedClose" aria-label="关闭">×</button></div><input type="hidden" id="ownerClosedId"><input type="hidden" id="ownerClosedPositionId"><section class="owner-close-snapshot" id="ownerClosedSnapshot" hidden></section><div class="owner-form-grid">
      <label><span>资产</span><select id="ownerClosedAsset" required><option value="BTC">BTC</option><option value="ETH">ETH</option><option value="HYPE">HYPE</option></select></label>
      <label><span>行权价</span><input id="ownerClosedStrike" type="number" min="0" step="any" inputmode="decimal" placeholder="例如 60000" required></label>
      <label><span>到期日</span><input id="ownerClosedExpiry" type="date" required></label>
      <label><span id="ownerClosedNotionalLabel">BTC 名义数量</span><input id="ownerClosedNotional" type="number" min="0.01" step="any" inputmode="decimal" value="1" required></label>
      <label><span>开仓日期</span><input id="ownerClosedOpenDate" type="date" required></label>
      <label><span>平仓 / 结算日期</span><input id="ownerClosedCloseDate" type="date" required></label>
      <label><span id="ownerClosedPremiumLabel">开仓权利金 / 1 BTC</span><input id="ownerClosedPremium" type="number" min="0" step="any" inputmode="decimal" placeholder="开仓时收到" required></label>
      <label><span id="ownerClosedCostLabel">平仓 / 结算成本 / 1 BTC</span><input id="ownerClosedCost" type="number" min="0" step="any" inputmode="decimal" placeholder="归零时填 0" required></label>
      <label><span>手续费 USD</span><input id="ownerClosedFees" type="number" min="0" step="any" inputmode="decimal" value="0" required><small id="ownerClosedFeeNote">请输入实际手续费</small></label>
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

  function currentCloseFeeEstimate(){
    const positionId=$("ownerClosedPositionId").value;
    if(!positionId)return null;
    const positionValue=positions.find(row=>String(row.id)===String(positionId));
    if(!positionValue)return null;
    const snapshot=snapshotForPosition(positionId);
    const research=researchFor(positionValue.asset);
    const spot=Journal.sourceUsable(research)?Number(research?.spot):null;
    return Journal.estimateCloseFee({
      venue:snapshot?.venue||"deribit",spotUsd:spot,
      closeCostPerUnit:$("ownerClosedCost").value,
      notional:$("ownerClosedNotional").value,
    });
  }

  function applyCloseFeeEstimate(){
    if(!closeFeeAuto)return;
    const estimate=currentCloseFeeEstimate();
    const note=$("ownerClosedFeeNote");
    if(!estimate){
      note.textContent="缺少新鲜现价或平仓成本，请手动填写实际手续费";
      return;
    }
    $("ownerClosedFees").value=estimate.fee_usd.toFixed(2);
    note.textContent=`${Journal.VENUE_LABELS[estimate.venue]} 估算 · ${estimate.assumption}；可手动覆盖`;
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
    $("ownerClosedForm").addEventListener("input",event=>{
      if(event.target?.id==="ownerClosedFees"){
        closeFeeAuto=false;
        $("ownerClosedFeeNote").textContent="已手动修改；以交易所实际账单为准";
      }else if(["ownerClosedCost","ownerClosedNotional"].includes(event.target?.id)){
        applyCloseFeeEstimate();
      }
      if(!$("ownerClosedId").value&&!$("ownerClosedPositionId").value){
        localStorage.setItem(CLOSED_DRAFT_KEY,JSON.stringify(closedRecordDraft()));
      }
      updateClosedRecordPreview();
    });
  }

  function setClosedSourceMode(sourcePosition=null){
    const linked=Boolean(sourcePosition);
    $("ownerClosedPositionId").value=sourcePosition?.id||"";
    $("ownerClosedAsset").disabled=linked;
    for(const id of [
      "ownerClosedStrike","ownerClosedExpiry","ownerClosedNotional",
      "ownerClosedOpenDate","ownerClosedPremium",
    ])$(id).readOnly=linked;
  }

  function openClosedRecordDialog(existing=null,sourcePosition=null){
    const draft=existing||sourcePosition?null:readStoredJson(CLOSED_DRAFT_KEY);
    const linked=sourcePosition?{
      asset:sourcePosition.asset,
      strike:sourcePosition.strike,
      expiry:sourcePosition.expiry,
      notional:sourcePosition.notional_btc,
      open_date:sourcePosition.open_date,
      open_premium_per_unit:sourcePosition.open_premium_per_btc,
    }:null;
    const row=existing||linked||draft||{};
    const asset=Strategy.normalizeAsset(row.asset||currentMarketAsset());
    $("ownerClosedTitle").textContent=existing?"编辑平仓记录":sourcePosition?"确认平仓":"录入平仓记录";
    $("ownerClosedSubtitle").textContent=sourcePosition
      ?"填写实际平仓结果；保存后，该仓位会移入已平仓记录。"
      :"只记录已确认的实现结果，不读取交易所数据。";
    $("ownerClosedSave").textContent=existing?"保存修改":sourcePosition?"确认平仓":"添加记录";
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
    setClosedSourceMode(sourcePosition);
    const snapshot=sourcePosition?snapshotForPosition(sourcePosition.id):null;
    const snapshotNode=$("ownerClosedSnapshot");
    snapshotNode.hidden=!sourcePosition;
    if(sourcePosition){
      snapshotNode.innerHTML=`<div><span class="owner-kicker">OPEN SNAPSHOT</span><strong>开仓时看到的证据</strong></div>${snapshotReviewHtml(snapshot)}`;
    }else snapshotNode.innerHTML="";
    closeFeeAuto=Boolean(sourcePosition);
    $("ownerClosedFeeNote").textContent=sourcePosition?"等待平仓成本以估算":"请输入实际手续费";
    applyCloseFeeEstimate();
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
    const sourcePositionId=$("ownerClosedPositionId").value;
    const closingPosition=Boolean(sourcePositionId);
    try{
      const normalized=Strategy.normalizeClosedPosition(closedRecordDraft());
      const recordBody={
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
      const rows=closingPosition
        ?await rest("rpc/close_owner_position",{
          method:"POST",
          body:{
            p_position_id:sourcePositionId,
            p_close_date:normalized.close_date,
            p_close_cost_per_unit:normalized.close_cost_per_unit,
            p_fees_usd:normalized.fees_usd,
            p_notes:normalized.notes,
            p_close_spot_usd:(()=>{
              const research=researchFor(normalized.asset);
              return Journal.sourceUsable(research)?Number(research?.spot):null;
            })(),
          },
        })
        :await rest(
          id?`closed_positions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${session.user.id}`:"closed_positions",
          {method:id?"PATCH":"POST",body:recordBody,prefer:"return=representation"},
        );
      if(!rows?.length)throw new Error("平仓记录没有保存成功");
      localStorage.removeItem(CLOSED_DRAFT_KEY);
      if(closingPosition)expandedPositionIds.delete(sourcePositionId);
      closeClosedRecordDialog();
      await loadPrivateData();
      setNotice(editing?"平仓记录已更新。":closingPosition?"持仓已平仓并移入记录。":"平仓记录已加入。","ok");
    }catch(error){
      errorNode.textContent=error.message;
    }finally{
      button.disabled=false;
      button.textContent=editing?"保存修改":closingPosition?"确认平仓":"添加记录";
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
    renderOwnerReview();
    renderOwnerPortfolio();
    renderOwnerScenario();
    renderEntry();
    try{
      const [stateRows,positionRows,closedRows,snapshotRows,reviewRows]=await Promise.all([
        rest(`owner_state?select=*&owner_id=eq.${session.user.id}&limit=1`),
        rest(`positions?select=*&owner_id=eq.${session.user.id}&order=expiry.asc,created_at.asc`),
        rest(`closed_positions?select=*&owner_id=eq.${session.user.id}&order=close_date.desc,created_at.desc`),
        rest(`position_open_snapshots?select=*&owner_id=eq.${session.user.id}&order=created_at.desc`),
        rest(`position_close_reviews?select=*&owner_id=eq.${session.user.id}&order=updated_at.desc`),
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
      openSnapshots=(snapshotRows||[]).map(Journal.normalizeSnapshot);
      closeReviews=(reviewRows||[]).map(Journal.normalizeReview);
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
    renderOwnerReview();
    renderOwnerPortfolio();
    renderOwnerScenario();
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
    renderOwnerPortfolio();
    renderOwnerScenario();
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
      renderOwnerReview();
      renderOwnerPortfolio();
      renderOwnerScenario();
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
      if(localPreview)return;
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
    if(shareRoute){
      await loadOwnerShares();
      return;
    }
    if(reviewRoute){
      await loadPrivateData.call(null);
      return;
    }
    if(portfolioRoute||scenarioRoute){
      await loadPrivateData.call(null);
      refreshResearch(true);
      scheduleRefresh();
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

  async function bootLocalPreview(){
    session={
      access_token:"local-preview",refresh_token:"local-preview",
      expires_at:Math.floor(Date.now()/1000)+86400,
      user:{id:LOCAL_PREVIEW_OWNER_ID,email:"local-preview@localhost"},
    };
    ownerState=Strategy.normalizeOwnerState({
      owner_id:LOCAL_PREVIEW_OWNER_ID,stablecoin_usd:0,
    });
    positions=[];
    closedPositions=[];
    openSnapshots=[];
    closeReviews=[];
    privateReady=true;
    showOwner();
    installOwnerUi();
    bindGlobalActionsOnce();
    if(shareRoute){
      renderOwnerShare();
    }else if(stockRoute){
      window.MangoDashboard?.prepareStockSearch?.();
    }else{
      window.MangoDashboard?.start?.();
    }
    renderAccount();
    renderPositions();
    renderOwnerReview();
    renderOwnerPortfolio();
    renderOwnerScenario();
    renderEntry();
    setNotice("本地预览模式：不读取或写入生产私有账本。","warn");
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
    if(localPreview){await bootLocalPreview();return}
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
