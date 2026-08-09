(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.DecisionJournal=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const DAY_MS=86400000;
  const ASSETS=["BTC","ETH","HYPE"];
  const VENUES=["binance","okx","deribit"];
  const VENUE_LABELS={binance:"Binance",okx:"OKX",deribit:"Deribit"};
  const EXIT_LABELS={
    capture_70_25:"70/25",
    low_remaining_apr:"低剩余 APR",
    spot_touch_strike:"触及 Strike",
    held_to_expiry:"持有到期",
    manual_other:"人工其他",
  };

  function finite(value){
    if(value===null||value===undefined||value==="")return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function text(value,max=1000){
    const normalized=String(value??"").trim();
    if(normalized.length>max)throw new Error(`文字不能超过 ${max} 字符`);
    return normalized||null;
  }

  function normalizeVenue(value){
    const venue=String(value||"deribit").trim().toLowerCase();
    if(!VENUES.includes(venue))throw new Error("交易平台无效");
    return venue;
  }

  // Standard taker estimates as of 2026-08. They are deliberately editable in
  // the close dialog because account tiers, promotions and settlement fees vary.
  function estimateCloseFee({venue,spotUsd,closeCostPerUnit,notional}){
    const normalizedVenue=normalizeVenue(venue);
    const spot=finite(spotUsd);
    const premium=finite(closeCostPerUnit);
    const amount=finite(notional);
    if(spot===null||spot<=0||premium===null||premium<0||amount===null||amount<=0){
      return null;
    }
    const model=normalizedVenue==="okx"
      ?{underlyingRate:.0003,premiumCap:.07,label:"标准 taker：0.03% 标的，上限为权利金 7%"}
      :normalizedVenue==="binance"
        ?{underlyingRate:.0003,premiumCap:.10,label:"标准交易费：0.03% 标的，上限为权利金 10%"}
        :{underlyingRate:.0003,premiumCap:.125,label:"标准期权费：0.03% 标的，上限为权利金 12.5%"};
    return {
      venue:normalizedVenue,
      fee_usd:Math.min(model.underlyingRate*spot,model.premiumCap*premium)*amount,
      assumption:model.label,
    };
  }

  function dateMs(value){
    const timestamp=Date.parse(`${String(value||"")}T00:00:00Z`);
    return Number.isFinite(timestamp)?timestamp:null;
  }

  function sourceUsable(research,nowMs=Date.now()){
    const status=research?.source_status;
    const asof=finite(status?.chain_asof_epoch_ms);
    const ttl=finite(status?.quote_ttl_seconds);
    if(!status||status.chain_stale!==false||asof===null||ttl===null||ttl<=0)return false;
    const age=nowMs-asof;
    return age>=-5000&&age<=ttl*1000;
  }

  function findQuote(position,research){
    if(String(research?.asset||"").toUpperCase()!==String(position?.asset||"").toUpperCase()){
      return null;
    }
    return (research?.puts||[]).find(row=>
      String(row.expiry)===String(position.expiry)&&
      Math.abs(Number(row.strike)-Number(position.strike))<1e-8
    )||null;
  }

  function buildOpenSnapshot({
    position,research,timing=null,availableBefore=null,reasonText="",venue="deribit",
    nowMs=Date.now(),
  }){
    const quote=findQuote(position,research);
    const usable=Boolean(quote)&&sourceUsable(research,nowMs);
    const asof=finite(research?.source_status?.chain_asof_epoch_ms);
    const age=asof===null?null:Math.max(0,Math.round((nowMs-asof)/1000));
    const card=quote?.card||{};
    const expected=card.expected||{};
    const capital=finite(position?.strike)*finite(position?.notional_btc);
    const cvarReturn=finite(expected.cvar95_horizon_return_pct);
    const timingAsset=String(timing?.asset||position?.asset||"").toUpperCase();
    const sameTimingAsset=timingAsset===String(position?.asset||"").toUpperCase();
    return {
      venue:normalizeVenue(venue),
      spot_usd:usable?finite(research?.spot):null,
      bid_per_unit:usable?finite(quote?.bid_usd):null,
      ask_per_unit:usable?finite(quote?.ask_usd):null,
      mark_per_unit:usable?finite(quote?.mark_usd):null,
      iv_pct:usable&&finite(quote?.iv)!==null?finite(quote.iv)/100:null,
      delta:usable?finite(quote?.delta):null,
      gamma:usable?finite(quote?.gamma):null,
      theta_usd_per_day:usable?finite(quote?.theta):null,
      vega_usd_per_iv_pt:usable?finite(quote?.vega):null,
      timing_signal:sameTimingAsset?text(timing?.action_code||timing?.action||"",64):null,
      quote_freshness_seconds:age,
      conditional_apr_pct:usable?finite(card.net_conditional_apr_pct):null,
      expected_excess_rwa_apr_pct:usable
        ?finite(expected.expected_excess_rwa_apr_pct):null,
      cvar95_usd:usable&&cvarReturn!==null&&Number.isFinite(capital)
        ?capital*cvarReturn/100:null,
      available_before_usd:finite(availableBefore),
      reason_text:text(reasonText),
    };
  }

  function normalizeSnapshot(raw){
    if(!raw?.id||!raw?.position_id)throw new Error("开仓快照字段无效");
    const asset=String(raw.asset||"").toUpperCase();
    if(!ASSETS.includes(asset))throw new Error("开仓快照资产无效");
    return {
      ...raw,
      venue:normalizeVenue(raw.venue),
      asset,
      strike:finite(raw.strike),notional:finite(raw.notional),
      open_premium_per_unit:finite(raw.open_premium_per_unit),
      spot_usd:finite(raw.spot_usd),bid_per_unit:finite(raw.bid_per_unit),
      ask_per_unit:finite(raw.ask_per_unit),mark_per_unit:finite(raw.mark_per_unit),
      iv_pct:finite(raw.iv_pct),delta:finite(raw.delta),gamma:finite(raw.gamma),
      theta_usd_per_day:finite(raw.theta_usd_per_day),
      vega_usd_per_iv_pt:finite(raw.vega_usd_per_iv_pt),
      dte_at_open:finite(raw.dte_at_open),k_times_q_usd:finite(raw.k_times_q_usd),
      conditional_apr_pct:finite(raw.conditional_apr_pct),
      expected_excess_rwa_apr_pct:finite(raw.expected_excess_rwa_apr_pct),
      cvar95_usd:finite(raw.cvar95_usd),
      available_before_usd:finite(raw.available_before_usd),
      reason_text:text(raw.reason_text),
    };
  }

  function normalizeReview(raw){
    if(!raw?.id||!raw?.closed_position_id)throw new Error("平仓复盘字段无效");
    return {
      ...raw,
      hit_70_capture:typeof raw.hit_70_capture==="boolean"?raw.hit_70_capture:null,
      hit_25_time:typeof raw.hit_25_time==="boolean"?raw.hit_25_time:null,
      held_days:finite(raw.held_days),
      realized_apr_on_kq_pct:finite(raw.realized_apr_on_kq_pct),
      review_text:text(raw.review_text),
      would_repeat:typeof raw.would_repeat==="boolean"?raw.would_repeat:null,
    };
  }

  function joinReviewRows(closedPositions,snapshots,reviews){
    const snapshotByPosition=new Map(snapshots.map(row=>[String(row.position_id),row]));
    const reviewByClosed=new Map(reviews.map(row=>[String(row.closed_position_id),row]));
    return closedPositions.map(closed=>{
      const snapshot=snapshotByPosition.get(String(closed.source_position_id||""))||null;
      const review=reviewByClosed.get(String(closed.id))||null;
      const capital=finite(closed.strike)*finite(closed.notional);
      const heldDays=review?.held_days??Math.max(0,
        ((dateMs(closed.close_date)??0)-(dateMs(closed.open_date)??0))/DAY_MS,
      );
      const realizedPnl=finite(closed.realized_pnl)??finite(closed.realized_pnl_usd)??0;
      const realizedApr=review?.realized_apr_on_kq_pct??(
        capital>0&&heldDays>0?realizedPnl/capital/heldDays*365*100:null
      );
      const openPremium=finite(closed.open_premium_per_unit);
      const closeCost=finite(closed.close_cost_per_unit);
      const capture=openPremium>0&&closeCost!==null
        ?(openPremium-closeCost)/openPremium*100:null;
      return {
        closed,snapshot,review,held_days:heldDays,realized_pnl:realizedPnl,
        realized_apr_on_kq_pct:realizedApr,capture_pct:capture,
        reviewed:Boolean(review?.review_text||typeof review?.would_repeat==="boolean"),
      };
    });
  }

  function aggregate(rows){
    const count=rows.length;
    const wins=rows.filter(row=>row.realized_pnl>0).length;
    const capture=rows.map(row=>finite(row.capture_pct)).filter(value=>value!==null);
    const held=rows.map(row=>finite(row.held_days)).filter(value=>value!==null);
    const aprs=rows.map(row=>finite(row.realized_apr_on_kq_pct)).filter(value=>value!==null);
    return {
      count,
      wins,
      win_rate_pct:count?wins/count*100:null,
      average_capture_pct:capture.length?capture.reduce((a,b)=>a+b,0)/capture.length:null,
      average_held_days:held.length?held.reduce((a,b)=>a+b,0)/held.length:null,
      average_rwa_apr_pct:aprs.length?aprs.reduce((a,b)=>a+b,0)/aprs.length:null,
      realized_pnl_total:rows.reduce((sum,row)=>sum+row.realized_pnl,0),
    };
  }

  function grouped(rows,keyFor){
    const groups=new Map();
    for(const row of rows){
      const key=keyFor(row);
      if(key===null||key===undefined)continue;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(row);
    }
    return [...groups.entries()].map(([key,value])=>({key,...aggregate(value)}));
  }

  function ivBucket(row){
    const iv=finite(row.snapshot?.iv_pct);
    if(iv===null)return null;
    if(iv<.4)return "IV < 40%";
    if(iv<=.6)return "IV 40–60%";
    return "IV > 60%";
  }

  function strategySummary(rows){
    return {
      all:aggregate(rows),
      by_asset:grouped(rows,row=>row.closed.asset),
      by_70_25:grouped(rows,row=>
        row.review?.hit_70_capture===true&&row.review?.hit_25_time===true?"命中":"未命中"
      ),
      by_iv:grouped(rows,ivBucket),
      by_month:grouped(rows,row=>String(row.closed.close_date||"").slice(0,7)),
    };
  }

  function filterRows(rows,{month="all",asset="all",rule="all"}={}){
    return rows.filter(row=>{
      if(month!=="all"&&!String(row.closed.close_date||"").startsWith(month))return false;
      if(asset!=="all"&&row.closed.asset!==asset)return false;
      if(rule!=="all"&&row.review?.exit_reason_code!==rule)return false;
      return true;
    });
  }

  return {
    EXIT_LABELS,VENUE_LABELS,buildOpenSnapshot,normalizeSnapshot,normalizeReview,
    joinReviewRows,aggregate,strategySummary,filterRows,sourceUsable,
    normalizeVenue,estimateCloseFee,
  };
});
