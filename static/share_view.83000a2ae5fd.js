(function(root,factory){
  const api=factory(root);
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.ShareView=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  }

  function extractToken(pathname,search=""){
    const match=String(pathname||"").match(/\/share\/([A-Za-z0-9_-]{32})\/?$/);
    if(match)return match[1];
    const query=new URLSearchParams(search);
    const token=query.get("token")||"";
    return /^[A-Za-z0-9_-]{32}$/.test(token)?token:"";
  }

  function localPreviewKind(hostname,search=""){
    if(!["localhost","127.0.0.1"].includes(String(hostname||"").toLowerCase()))return "";
    return new URLSearchParams(search).get("preview")||"";
  }

  function activateShareRoute(documentNode,pathname){
    if(!documentNode||!/^\/share(?:\/|$)/.test(String(pathname||"")))return false;
    documentNode.documentElement?.classList?.add("share-route");
    return true;
  }

  function value(value,suffix=""){
    return value===null||value===undefined||!Number.isFinite(Number(value))?"—":`${Number(value).toFixed(1)}${suffix}`;
  }

  function kindTitle(kind){
    return ({
      track_record:"Sell Put Track Record",
      current_positions:"Sell Put 当前持仓快照",
      strategy_summary:"Sell Put 策略规则摘要",
    })[kind]||"Sell Put 只读快照";
  }

  function metric(label,valueText,detail=""){
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(valueText)}</strong>${detail?`<small>${escapeHtml(detail)}</small>`:""}</div>`;
  }

  function trackRecordHtml(snapshot){
    const summary=snapshot.summary||{};
    const assets=(snapshot.by_asset||[]).map(row=>`<tr><td>${escapeHtml(row.asset)}</td><td>${escapeHtml(row.closed)}</td><td>${value(row.win_rate_pct,"%")}</td><td>${value(row.avg_rwa_apr_pct,"%")}</td></tr>`).join("");
    const months=(snapshot.by_month||[]).map(row=>`<tr><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.closed)}</td></tr>`).join("");
    return `<section class="share-metrics">${metric("已平仓",String(summary.total_closed??0),"笔")}${metric("胜率",value(summary.win_rate_pct,"%"))}${metric("平均捕获",value(summary.avg_capture_pct,"%"))}${metric("平均持有",value(summary.avg_held_days," 天"))}${metric("平均 RWA 年化",value(summary.avg_rwa_apr_pct,"%"))}</section><div class="share-grid"><section class="share-table"><h3>按资产</h3><table><thead><tr><th>资产</th><th>笔数</th><th>胜率</th><th>平均 RWA 年化</th></tr></thead><tbody>${assets||'<tr><td colspan="4">暂无记录</td></tr>'}</tbody></table></section><section class="share-table"><h3>按月</h3><table><thead><tr><th>月份</th><th>平仓笔数</th></tr></thead><tbody>${months||'<tr><td colspan="2">暂无记录</td></tr>'}</tbody></table></section></div>`;
  }

  function positionsHtml(snapshot){
    const rows=(snapshot.positions||[]).map(row=>`<tr><td>${escapeHtml(row.asset)}</td><td>${escapeHtml(row.strike)}</td><td>${escapeHtml(row.expiry)}</td><td>${escapeHtml(row.dte??"—")}</td><td>${value(row.capture_pct,"%")}</td><td>${value(row.remaining_apr_pct,"%")}</td><td>${escapeHtml(row.status)}</td></tr>`).join("");
    return `<section class="share-table"><h3>当前持仓快照</h3><table><thead><tr><th>资产</th><th>Strike</th><th>到期日</th><th>DTE</th><th>捕获</th><th>剩余 APR</th><th>状态</th></tr></thead><tbody>${rows||'<tr><td colspan="7">生成快照时没有持仓</td></tr>'}</tbody></table></section>`;
  }

  function strategyHtml(snapshot){
    return `<section class="share-rules"><h3>${escapeHtml(snapshot.title||"策略规则摘要")}</h3><ol>${(snapshot.rules||[]).map(rule=>`<li>${escapeHtml(rule)}</li>`).join("")}</ol></section>`;
  }

  function snapshotHtml(snapshot){
    if(snapshot?.kind==="track_record")return trackRecordHtml(snapshot);
    if(snapshot?.kind==="current_positions")return positionsHtml(snapshot);
    if(snapshot?.kind==="strategy_summary")return strategyHtml(snapshot);
    return '<div class="share-message">快照格式不可用。</div>';
  }

  function previewPayload(kind){
    if(kind==="current_positions")return {kind,generated_at:new Date().toISOString(),positions:[{asset:"BTC",strike:90000,expiry:"2026-09-09",dte:30,capture_pct:50,remaining_apr_pct:13.5,status:"正常"}]};
    if(kind==="strategy_summary")return {kind,generated_at:new Date().toISOString(),title:"Sell Put 策略规则摘要",rules:["70/25：权利金捕获与时间进度共同进入平仓复核。","8% RWA：现金机会成本单独比较。","K×Q：完整经济资本口径。"]};
    return {kind:"track_record",generated_at:new Date().toISOString(),summary:{total_closed:12,win_rate_pct:75,avg_capture_pct:68.2,avg_held_days:14.5,avg_rwa_apr_pct:13.8},by_month:[{month:"2026-07",closed:7},{month:"2026-08",closed:5}],by_asset:[{asset:"BTC",closed:8,win_rate_pct:75,avg_rwa_apr_pct:14.2},{asset:"ETH",closed:4,win_rate_pct:75,avg_rwa_apr_pct:13}]};
  }

  function install(){
    if(typeof document==="undefined"||!/^\/share(?:\/|$)/.test(location.pathname))return;
    const page=document.getElementById("sharePage");
    const body=document.getElementById("shareBody");
    const meta=document.getElementById("shareMeta");
    const form=document.getElementById("sharePasswordForm");
    const error=document.getElementById("shareError");
    const title=document.getElementById("shareTitle");
    if(!page||!body||!meta||!form||!error||!title)return;
    const preview=localPreviewKind(location.hostname,location.search);
    const token=extractToken(location.pathname,location.search);
    const apiBase=String(root.MANGO_SHARE_API_BASE||("https://yvpgdnbcjgxpjqenhvuo.supabase.co/functions/v1/share-api")).replace(/\/$/,"");
    async function load(password=""){
      if(preview){
        const snapshot=previewPayload(preview);
        title.textContent=kindTitle(snapshot.kind);
        body.innerHTML=snapshotHtml(snapshot);
        meta.textContent=`生成时间 ${new Date(snapshot.generated_at).toLocaleString()}`;
        return;
      }
      if(!token){body.innerHTML='<div class="share-message">分享链接格式无效。</div>';return}
      error.textContent="";
      body.innerHTML='<div class="share-message">正在读取只读快照…</div>';
      const response=await fetch(`${apiBase}/public/${encodeURIComponent(token)}`,{
        method:password?"POST":"GET",cache:"no-store",
        headers:password?{"content-type":"application/json"}:undefined,
        body:password?JSON.stringify({password}):undefined,
      });
      let payload={};try{payload=await response.json()}catch(_){ }
      if(response.status===401&&payload.password_required){
        form.hidden=false;body.innerHTML="";document.getElementById("sharePassword").focus();return;
      }
      form.hidden=true;
      if(response.status===410){body.innerHTML='<div class="share-message bad"><strong>链接已失效</strong><span>链接已过期或被分享者撤销。</span></div>';return}
      if(!response.ok){body.innerHTML='<div class="share-message bad">快照暂时无法读取。</div>';return}
      title.textContent=kindTitle(payload.snapshot?.kind||payload.kind);
      body.innerHTML=snapshotHtml(payload.snapshot);
      meta.textContent=`生成时间 ${new Date(payload.snapshot.generated_at).toLocaleString()} · 有效期至 ${new Date(payload.expires_at).toLocaleString()}`;
    }
    form.addEventListener("submit",event=>{
      event.preventDefault();
      const input=document.getElementById("sharePassword");
      if(!/^\d{4,8}$/.test(input.value)){error.textContent="请输入 4–8 位数字密码。";return}
      load(input.value).catch(()=>{error.textContent="密码验证失败，请重试。"});
    });
    load().catch(()=>{body.innerHTML='<div class="share-message bad">快照暂时无法读取。</div>'});
  }

  if(typeof document!=="undefined"){
    activateShareRoute(document,location.pathname);
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
    else install();
  }

  return {escapeHtml,extractToken,localPreviewKind,activateShareRoute,value,kindTitle,snapshotHtml,previewPayload};
});
