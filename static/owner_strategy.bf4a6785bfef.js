(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.OwnerStrategy=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const RWA_APY=0.08;
  const CAPTURE_EXIT=70;
  const TIME_EXIT=25;
  const EXIT_APR_BUFFER_PP=2;
  const MIN_RESEARCH_DTE=7;
  const MAX_RESEARCH_SPREAD_PCT=15;
  const DAY_MS=86400000;
  const SUPPORTED_ASSETS=["BTC","ETH","HYPE"];
  const ASSET_MIN_NOTIONAL={BTC:.01,ETH:.1,HYPE:10};

  const LABELS={
    entry:{
      not_due:"未到开仓复核点",
      review:"进入开仓复核",
      unknown:"暂无法判断",
    },
    close:{
      not_due:"未到平仓复核点",
      review:"进入平仓复核",
      risk:"风险优先处理",
      unknown:"暂无法判断",
    },
  };

  function finite(value){
    if(value===null||value===undefined||value==="")return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function nonNegative(value,{nullable=false}={}){
    if(nullable&&(value==null||value===""))return null;
    const number=finite(value);
    return number!==null&&number>=0?number:null;
  }

  function positive(value){
    const number=finite(value);
    return number!==null&&number>0?number:null;
  }

  function optionalPositive(value){
    if(value==null||value==="")return null;
    return positive(value);
  }

  function normalizeAsset(value="BTC"){
    const asset=String(value||"BTC").trim().toUpperCase();
    if(!SUPPORTED_ASSETS.includes(asset)){
      throw new Error("持仓资产只支持 BTC / ETH / HYPE");
    }
    return asset;
  }

  function researchForAsset(assetValue,researchValue){
    const asset=normalizeAsset(assetValue);
    if(researchValue?.puts&&normalizeAsset(researchValue.asset||"BTC")===asset){
      return researchValue;
    }
    const candidate=researchValue?.[asset];
    return candidate?.asset===asset?candidate:null;
  }

  function validDate(value){
    const text=String(value||"");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
    const timestamp=Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===text;
  }

  function utcDate(nowMs=Date.now()){
    return new Date(nowMs).toISOString().slice(0,10);
  }

  function dateMs(value){
    return Date.parse(`${value}T00:00:00Z`);
  }

  function isExpired(position,nowMs=Date.now()){
    return String(position.expiry)<utcDate(nowMs);
  }

  function dte(position,nowMs=Date.now()){
    return Math.max(0,(dateMs(position.expiry)-dateMs(utcDate(nowMs)))/DAY_MS);
  }

  function normalizeOwnerState(raw={}){
    const stablecoinValue=raw.stablecoin_usd??raw.stablecoinUsd??0;
    const buyBandLowValue=raw.buy_band_low??raw.buyBandLow;
    const buyBandHighValue=raw.buy_band_high??raw.buyBandHigh;
    const cashFloorValue=raw.cash_floor_usd??raw.cashFloorUsd;
    const stablecoinUsd=nonNegative(stablecoinValue);
    const buyBandLow=optionalPositive(buyBandLowValue);
    const buyBandHigh=optionalPositive(buyBandHighValue);
    const cashFloorUsd=nonNegative(cashFloorValue,{nullable:true});
    if(stablecoinUsd===null||
      (buyBandLow===null&&buyBandLowValue!==null&&buyBandLowValue!==undefined&&buyBandLowValue!=="")||
      (buyBandHigh===null&&buyBandHighValue!==null&&buyBandHighValue!==undefined&&buyBandHighValue!=="")||
      (cashFloorUsd===null&&cashFloorValue!==null&&cashFloorValue!==undefined&&cashFloorValue!=="")){
      throw new Error("账户数字无效");
    }
    if((buyBandLow===null)!==(buyBandHigh===null))throw new Error("买入带上下沿必须同时填写");
    if(buyBandLow!==null&&buyBandHigh!==null&&buyBandLow>buyBandHigh){
      throw new Error("买入带下沿不能高于上沿");
    }
    return {
      owner_id:raw.owner_id||null,
      stablecoin_usd:stablecoinUsd,
      buy_band_low:buyBandLow,
      buy_band_high:buyBandHigh,
      cash_floor_usd:cashFloorUsd,
      updated_at:raw.updated_at||null,
    };
  }

  function normalizePosition(raw){
    const strike=positive(raw?.strike);
    const notional=positive(raw?.notional_btc);
    const premium=nonNegative(raw?.open_premium_per_btc);
    const expiry=String(raw?.expiry||"");
    const openDate=String(raw?.open_date||"");
    const asset=normalizeAsset(raw?.asset);
    if(!raw?.id||strike===null||notional===null||premium===null||
      notional<ASSET_MIN_NOTIONAL[asset]||
      !validDate(expiry)||!validDate(openDate)||openDate>expiry){
      throw new Error("持仓字段无效");
    }
    if(raw.kind&&raw.kind!=="sell_put")throw new Error("Owner 只支持 Sell Put");
    return {
      id:String(raw.id),
      owner_id:raw.owner_id||null,
      asset,
      kind:"sell_put",
      strike,
      expiry,
      notional_btc:notional,
      open_premium_per_btc:premium,
      open_date:openDate,
      created_at:raw.created_at||null,
      updated_at:raw.updated_at||null,
    };
  }

  function closedPositionMetrics(record){
    const grossPnl=(record.open_premium_per_unit-record.close_cost_per_unit)*record.notional;
    const realizedPnl=grossPnl-record.fees_usd;
    const capital=record.strike*record.notional;
    return {
      gross_pnl:grossPnl,
      realized_pnl:realizedPnl,
      return_on_capital_pct:capital>0?realizedPnl/capital*100:null,
      capital,
      hold_days:(dateMs(record.close_date)-dateMs(record.open_date))/DAY_MS,
    };
  }

  function normalizeClosedPosition(raw){
    const strike=positive(raw?.strike);
    const notional=positive(raw?.notional);
    const openPremium=nonNegative(raw?.open_premium_per_unit);
    const closeCost=nonNegative(raw?.close_cost_per_unit);
    const fees=nonNegative(raw?.fees_usd??0);
    const expiry=String(raw?.expiry||"");
    const openDate=String(raw?.open_date||"");
    const closeDate=String(raw?.close_date||"");
    const notes=String(raw?.notes||"").trim();
    const asset=normalizeAsset(raw?.asset);
    if(!raw?.id||strike===null||notional===null||openPremium===null||
      closeCost===null||fees===null||notional<ASSET_MIN_NOTIONAL[asset]||
      !validDate(expiry)||!validDate(openDate)||!validDate(closeDate)||
      openDate>expiry||openDate>closeDate||notes.length>500){
      throw new Error("平仓记录字段无效");
    }
    if(raw.kind&&raw.kind!=="sell_put")throw new Error("Owner 只支持 Sell Put");
    const record={
      id:String(raw.id),
      owner_id:raw.owner_id||null,
      asset,
      kind:"sell_put",
      strike,
      expiry,
      notional,
      open_premium_per_unit:openPremium,
      close_cost_per_unit:closeCost,
      fees_usd:fees,
      open_date:openDate,
      close_date:closeDate,
      notes,
      created_at:raw.created_at||null,
      updated_at:raw.updated_at||null,
    };
    return {...record,...closedPositionMetrics(record)};
  }

  function closedPositionSummary(records){
    const summary=records.reduce((result,recordValue)=>{
      const record=recordValue?.realized_pnl===undefined
        ?normalizeClosedPosition(recordValue)
        :recordValue;
      const pnl=finite(record.realized_pnl)??0;
      result.count++;
      result.realized_pnl_total+=pnl;
      result.fees_total+=finite(record.fees_usd)??0;
      if(pnl>0)result.win_count++;
      else if(pnl<0)result.loss_count++;
      else result.flat_count++;
      return result;
    },{
      count:0,realized_pnl_total:0,fees_total:0,
      win_count:0,loss_count:0,flat_count:0,win_rate_pct:null,
    });
    summary.win_rate_pct=summary.count?summary.win_count/summary.count*100:null;
    return summary;
  }

  function totals(ownerState,positions){
    const stablecoin=nonNegative(ownerState?.stablecoin_usd)??0;
    const putReserved=positions.reduce(
      (sum,position)=>sum+Number(position.strike)*Number(position.notional_btc),
      0,
    );
    return {
      put_reserved:putReserved,
      available:stablecoin-putReserved,
    };
  }

  function sourceUsable(research,nowMs=Date.now(),{history=false}={}){
    const status=research?.source_status;
    if(!status||status.chain_stale===true)return false;
    if(history&&status.history_stale!==false)return false;
    if(typeof status.chain_stale!=="boolean")return false;
    const asof=finite(status.chain_asof_epoch_ms);
    const ttl=finite(status.quote_ttl_seconds);
    if(asof===null||ttl===null||ttl<=0||ttl>300)return false;
    const age=nowMs-asof;
    return age>=-5000&&age<=ttl*1000;
  }

  function timingUsable(timing){
    if(!timing||timing.blocked===true)return false;
    if(!["sell","wait","no"].includes(timing.action))return false;
    return ![
      "stale","insufficient_history","volatility_unavailable",
      "iv_rv_unavailable","timing_inputs_unavailable",
    ].includes(timing.action_code);
  }

  function result(kind,state,reason,extra={}){
    return {state,verdict:LABELS[kind][state],reason,...extra};
  }

  function candidatePasses(candidate,ownerState,available,asset="BTC"){
    const strike=positive(candidate?.strike);
    const researchNotional=positive(candidate?.research_notional)??1;
    const days=finite(candidate?.days);
    const spread=finite(candidate?.spread_pct);
    const expected=finite(candidate?.card?.expected?.expected_excess_rwa_apr_pct);
    if(strike===null||days===null||days<MIN_RESEARCH_DTE||spread===null||
      spread>MAX_RESEARCH_SPREAD_PCT||expected===null||expected<=0||
      candidate?.status?.state!=="research"||strike*researchNotional>available){
      return false;
    }
    const low=ownerState.buy_band_low;
    const high=ownerState.buy_band_high;
    if(asset==="BTC"&&low!==null&&high!==null&&(strike<low||strike>high))return false;
    const floor=ownerState.cash_floor_usd;
    if(floor!==null&&available-strike*researchNotional<floor)return false;
    return true;
  }

  function evaluateEntry(ownerStateValue,positions,research,timing,nowMs=Date.now()){
    const ownerState=normalizeOwnerState(ownerStateValue);
    if(positions.some(position=>isExpired(position,nowMs))){
      return result("entry","not_due","先核对到期仓位的现金结算。");
    }
    const account=totals(ownerState,positions);
    if(account.available<=0){
      return result(
        "entry","not_due",
        account.available<0
          ?`现有 Put 已出现 ${Math.abs(account.available).toLocaleString("en-US",{maximumFractionDigits:2})} USD 承诺缺口。`
          :"现有 Put 已占满稳定币。",
      );
    }
    if(!sourceUsable(research,nowMs,{history:true})||!timingUsable(timing)){
      return result("entry","unknown","当前行情或经验数据不足以支持开仓复核。");
    }
    const timingAllowsEntry=timing.action==="sell";
    const asset=normalizeAsset(research?.asset||"BTC");
    const candidates=timingAllowsEntry?(research.puts||[]).filter(candidate=>
      candidatePasses(candidate,ownerState,account.available,asset)
    ):[];
    if(candidates.length){
      return result(
        "entry","review",
        `当前有 ${candidates.length} 个 ${asset} Sell Put 通过容量与策略筛选。`,
        {candidate_count:candidates.length},
      );
    }
    if(!timingAllowsEntry){
      return result("entry","not_due","当前择时信号尚未进入 Sell Put 开仓窗口。",{
        candidate_count:0,
      });
    }
    return result("entry","not_due","当前没有 Sell Put 通过策略筛选。",{candidate_count:0});
  }

  function findQuote(position,research){
    const assetResearch=researchForAsset(position.asset,research);
    return (assetResearch?.puts||[]).find(candidate=>
      String(candidate.expiry)===String(position.expiry)&&
      Math.abs(Number(candidate.strike)-Number(position.strike))<1e-8
    )||null;
  }

  function deribitStandardPutMargin(position,research,nowMs=Date.now()){
    const assetResearch=researchForAsset(position.asset,research);
    if(!sourceUsable(assetResearch,nowMs))return null;
    const spot=positive(assetResearch?.spot);
    const strike=positive(position?.strike);
    const notional=positive(position?.notional_btc);
    const premium=nonNegative(position?.open_premium_per_btc);
    const quote=findQuote(position,assetResearch);
    const mark=nonNegative(quote?.mark_usd,{nullable:true});
    if(spot===null||strike===null||notional===null||premium===null||mark===null){
      return null;
    }
    const otm=Math.max(spot-strike,0);
    const initialMargin=(Math.max(0.15*spot-otm,0.10*strike)+mark)*notional;
    const maintenanceMargin=(0.075*Math.min(spot,strike)+mark)*notional;
    const capacityCapital=strike*notional;
    const netOwnCapital=(strike-premium)*notional;
    return {
      venue:"Deribit",
      account_mode:"Standard Margin",
      initial_margin:initialMargin,
      maintenance_margin:maintenanceMargin,
      initial_margin_pct_of_capacity:initialMargin/capacityCapital*100,
      capacity_capital:capacityCapital,
      net_own_capital:netOwnCapital,
      above_im_dedicated_reserve:Math.max(netOwnCapital-initialMargin,0),
      mark_price:mark,
    };
  }

  function deribitCapitalSummary(positions,research,nowMs=Date.now()){
    const rows=positions.map(position=>
      deribitStandardPutMargin(position,research,nowMs)
    );
    if(rows.some(row=>row===null))return {complete:false,position_count:positions.length};
    return rows.reduce((summary,row)=>({
      complete:true,
      position_count:summary.position_count+1,
      initial_margin:summary.initial_margin+row.initial_margin,
      maintenance_margin:summary.maintenance_margin+row.maintenance_margin,
      capacity_capital:summary.capacity_capital+row.capacity_capital,
      net_own_capital:summary.net_own_capital+row.net_own_capital,
      above_im_dedicated_reserve:
        summary.above_im_dedicated_reserve+row.above_im_dedicated_reserve,
    }),{
      complete:true,position_count:0,initial_margin:0,maintenance_margin:0,
      capacity_capital:0,net_own_capital:0,above_im_dedicated_reserve:0,
    });
  }

  function annualizedSimple(amount,capital,days){
    if(!(capital>0)||!(days>0))return null;
    return amount/capital*365/days*100;
  }

  function normalizeStressRange(value){
    const number=finite(value);
    if(number===null)return null;
    return Math.round(Math.min(100,Math.max(1,number))*10)/10;
  }

  function stressScenarioRows(positionValue,item,spotValue,rangeValue){
    const card=item?.card||{};
    const spot=positive(spotValue);
    const strike=positive(positionValue?.strike);
    const capital=positive(card.economic_capital_usd);
    const netCredit=finite(card.net_credit_usd);
    const range=normalizeStressRange(rangeValue)??30;
    if(spot===null||strike===null||capital===null||netCredit===null){
      return card.stress||[];
    }
    const contractSize=capital/strike;
    const deliveryFeeExempt=(card.stress||[]).some(row=>
      Number(row.payout)>0&&Number(row.delivery_fee)===0
    );
    return [-range,-range/2,0,range/2,range].map(shockPct=>{
      const terminalPrice=Math.max(0,spot*(1+shockPct/100));
      const intrinsicPerUnit=Math.max(strike-terminalPrice,0);
      const payout=intrinsicPerUnit*contractSize;
      const deliveryFee=deliveryFeeExempt||intrinsicPerUnit===0?0:
        Math.min(0.00015*terminalPrice,0.125*intrinsicPerUnit)*contractSize;
      const pnl=netCredit-payout-deliveryFee;
      return {
        shock_pct:shockPct,
        terminal_price:terminalPrice,
        horizon_return_pct:pnl/capital*100,
        pnl,
      };
    });
  }

  function horizonIncome(capital,apy,days){
    if(!(capital>=0)||!(apy>=0)||!(days>=0))return null;
    return capital*(Math.pow(1+apy,days/365)-1);
  }

  function positionMetrics(position,research,nowMs=Date.now()){
    const assetResearch=researchForAsset(position.asset,research);
    const quote=findQuote(position,assetResearch);
    const currentBid=nonNegative(quote?.bid_usd,{nullable:true});
    const currentAsk=nonNegative(quote?.ask_usd,{nullable:true});
    const currentMark=nonNegative(quote?.mark_usd,{nullable:true});
    const premium=Number(position.open_premium_per_btc);
    const notional=Number(position.notional_btc);
    const remainingDays=dte(position,nowMs);
    const totalDays=(dateMs(position.expiry)-dateMs(position.open_date))/DAY_MS;
    const elapsedDays=Math.max(0,(dateMs(utcDate(nowMs))-dateMs(position.open_date))/DAY_MS);
    const rawTimeElapsedPct=totalDays<=0?(elapsedDays>0?100:0):elapsedDays/totalDays*100;
    const timeElapsedPct=Math.min(100,Math.max(0,rawTimeElapsedPct));
    const rawTimeRemainingPct=totalDays<=0?(remainingDays>0?100:0):remainingDays/totalDays*100;
    const timeRemainingPct=Math.min(100,Math.max(0,rawTimeRemainingPct));
    const quoteUsable=Boolean(quote)&&sourceUsable(assetResearch,nowMs)&&currentAsk!==null;
    const capturePct=!quoteUsable||premium<=0?null:(premium-currentAsk)/premium*100;
    const capacityCapital=position.strike*notional;
    const remainingValue=quoteUsable?currentAsk*notional:null;
    const remainingApr=!quoteUsable?null:annualizedSimple(
      remainingValue,capacityCapital,remainingDays,
    );
    const remainingHurdleCost=!quoteUsable||remainingDays<=0?null:
      horizonIncome(capacityCapital,RWA_APY,remainingDays);
    const remainingMaxNetValue=remainingHurdleCost===null?null:
      remainingValue-remainingHurdleCost;
    const remainingMaxNetApr=remainingMaxNetValue===null?null:
      annualizedSimple(remainingMaxNetValue,capacityCapital,remainingDays);
    const exitAprThreshold=RWA_APY*100+EXIT_APR_BUFFER_PP;
    const remainingAprBufferPp=remainingApr===null?null:
      remainingApr-exitAprThreshold;
    const closeCost=quoteUsable?currentAsk*notional:null;
    const unrealizedPnl=quoteUsable?(premium-currentAsk)*notional:null;
    const spot=sourceUsable(assetResearch,nowMs)?positive(assetResearch?.spot):null;
    const strikeDistancePct=spot===null?null:(spot-position.strike)/spot*100;
    let spreadPct=finite(quote?.spread_pct);
    if(spreadPct===null&&currentBid!==null&&currentAsk!==null&&currentAsk>=currentBid){
      const midpoint=(currentBid+currentAsk)/2;
      spreadPct=midpoint>0?(currentAsk-currentBid)/midpoint*100:null;
    }
    const asof=finite(assetResearch?.source_status?.chain_asof_epoch_ms);
    const quoteAgeSeconds=asof===null?null:Math.max(0,(nowMs-asof)/1000);
    return {
      quote,
      current_bid:currentBid,
      current_ask:currentAsk,
      current_mark:currentMark,
      quote_usable:quoteUsable,
      quote_age_seconds:quoteAgeSeconds,
      quote_asof_epoch_ms:asof,
      spread_pct:spreadPct,
      iv:finite(quote?.iv),
      delta:finite(quote?.delta),
      capture_pct:capturePct,
      open_dte:Math.max(0,totalDays),
      time_elapsed_pct:timeElapsedPct,
      time_remaining_pct:timeRemainingPct,
      dte:remainingDays,
      remaining_value:remainingValue,
      remaining_apr:remainingApr,
      remaining_hurdle_cost:remainingHurdleCost,
      remaining_max_net_value:remainingMaxNetValue,
      remaining_max_net_apr:remainingMaxNetApr,
      remaining_apr_buffer_pp:remainingAprBufferPp,
      exit_apr_threshold:exitAprThreshold,
      open_premium_total:premium*notional,
      close_cost:closeCost,
      unrealized_pnl:unrealizedPnl,
      strike_distance_pct: strikeDistancePct,
      capacity_capital:capacityCapital,
      effective_breakeven_price:Math.max(position.strike-premium,0),
      maximum_net_loss:Math.max(position.strike-premium,0)*notional,
      net_own_capital:(position.strike-premium)*notional,
    };
  }

  function portfolioSummary(ownerStateValue,positions,research,nowMs=Date.now()){
    const ownerState=normalizeOwnerState(ownerStateValue);
    const account=totals(ownerState,positions);
    const metrics=positions.map(position=>positionMetrics(position,research,nowMs));
    const quoteUnavailableCount=metrics.filter(row=>!row.quote_usable).length;
    const complete=quoteUnavailableCount===0;
    return {
      ...account,
      position_count:positions.length,
      quote_unavailable_count:quoteUnavailableCount,
      pnl_complete:complete,
      open_premium_total:metrics.reduce((sum,row)=>sum+row.open_premium_total,0),
      close_cost_total:complete
        ?metrics.reduce((sum,row)=>sum+row.close_cost,0)
        :null,
      unrealized_pnl_total:complete
        ?metrics.reduce((sum,row)=>sum+row.unrealized_pnl,0)
        :null,
    };
  }

  function evaluateClose(position,ownerStateValue,positions,research,nowMs=Date.now()){
    const assetResearch=researchForAsset(position.asset,research);
    const asset=normalizeAsset(position.asset);
    if(isExpired(position,nowMs)){
      return result("close","risk","仓位已到期，请先核对现金结算。",{
        metrics:positionMetrics(position,assetResearch,nowMs),
        verdict:"到期结算待确认",
      });
    }
    const ownerState=normalizeOwnerState(ownerStateValue);
    const account=totals(ownerState,positions);
    if(account.available<0){
      const format=value=>Number(value).toLocaleString("en-US",{
        maximumFractionDigits:2,
      });
      return result(
        "close","risk",
        `按完整现金覆盖口径：账户已录入稳定币 ${format(ownerState.stablecoin_usd)} USD，Put 完整承诺 ${format(account.put_reserved)} USD，差额 ${format(Math.abs(account.available))} USD。若余额尚未录入，请先更新账户设置。`,
        {
          metrics:positionMetrics(position,assetResearch,nowMs),
          verdict:"资金覆盖待确认",
        },
      );
    }
    if(!sourceUsable(assetResearch,nowMs)){
      return result("close","unknown",`当前 ${asset} 参考价已过期或不可用。`,{
        metrics:positionMetrics(position,assetResearch,nowMs),
      });
    }
    const metrics=positionMetrics(position,assetResearch,nowMs);
    const spot=positive(assetResearch?.spot);
    if(spot===null||!metrics.quote_usable){
      return result("close","unknown",`当前 ${asset} 参考价或合约 Ask 不可用，不计算平仓损益。`,{metrics});
    }
    if(metrics.capture_pct!==null&&metrics.capture_pct>=CAPTURE_EXIT&&
      metrics.time_elapsed_pct<=TIME_EXIT){
      return result(
        "close","review",
        "已用不超过 25% 期限捕获至少 70% 权利金，按策略默认退出并重新承保。",
        {metrics},
      );
    }
    if(metrics.remaining_apr!==null&&metrics.remaining_apr<RWA_APY*100+EXIT_APR_BUFFER_PP){
      return result(
        "close","review",
        "剩余最高年化不及 8% 策略门槛加 2pp 缓冲，资本效率不达标。",
        {metrics},
      );
    }
    if(spot<=position.strike){
      return result("close","review",`${asset} 参考价已触及或穿过这笔仓位的行权价。`,{metrics});
    }
    return result(
      "close","not_due",
      `${asset} 参考价尚未触及行权价，资本效率仍在门槛之上。`,
      {metrics},
    );
  }

  function closePriority(state){
    return state==="risk"?0:state==="review"?1:state==="unknown"?2:3;
  }

  function positionRows(ownerStateValue,positions,research,nowMs=Date.now(),filter="all"){
    const rows=positions.map(position=>{
      const decision=evaluateClose(
        position,ownerStateValue,positions,research,nowMs,
      );
      return {position,decision,metrics:decision.metrics};
    });
    const visible=rows.filter(row=>{
      if(filter==="attention")return row.decision.state!=="not_due";
      if(filter==="normal")return row.decision.state==="not_due";
      return true;
    });
    return visible.sort((a,b)=>
      closePriority(a.decision.state)-closePriority(b.decision.state)||
      String(a.position.expiry).localeCompare(String(b.position.expiry))||
      Number(b.position.strike)-Number(a.position.strike)
    );
  }

  return {
    RWA_APY,CAPTURE_EXIT,TIME_EXIT,EXIT_APR_BUFFER_PP,SUPPORTED_ASSETS,
    MIN_RESEARCH_DTE,MAX_RESEARCH_SPREAD_PCT,LABELS,
    finite,positive,optionalPositive,validDate,utcDate,isExpired,dte,
    normalizeAsset,researchForAsset,
    normalizeOwnerState,normalizePosition,normalizeClosedPosition,
    closedPositionMetrics,closedPositionSummary,totals,sourceUsable,
    annualizedSimple,horizonIncome,normalizeStressRange,stressScenarioRows,
    deribitStandardPutMargin,deribitCapitalSummary,
    positionMetrics,portfolioSummary,evaluateEntry,evaluateClose,
    closePriority,positionRows,
  };
});
