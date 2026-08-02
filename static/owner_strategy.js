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
    if(!raw?.id||strike===null||notional===null||premium===null||
      !validDate(expiry)||!validDate(openDate)||openDate>expiry){
      throw new Error("持仓字段无效");
    }
    if(raw.asset&&raw.asset!=="BTC")throw new Error("Owner v1 只支持 BTC");
    if(raw.kind&&raw.kind!=="sell_put")throw new Error("Owner v1 只支持 Sell Put");
    return {
      id:String(raw.id),
      owner_id:raw.owner_id||null,
      asset:"BTC",
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

  function candidatePasses(candidate,ownerState,available){
    const strike=positive(candidate?.strike);
    const days=finite(candidate?.days);
    const spread=finite(candidate?.spread_pct);
    const expected=finite(candidate?.card?.expected?.expected_excess_rwa_apr_pct);
    if(strike===null||days===null||days<MIN_RESEARCH_DTE||spread===null||
      spread>MAX_RESEARCH_SPREAD_PCT||expected===null||expected<=0||
      candidate?.status?.state!=="research"||strike>available){
      return false;
    }
    const low=ownerState.buy_band_low;
    const high=ownerState.buy_band_high;
    if(low!==null&&high!==null&&(strike<low||strike>high))return false;
    const floor=ownerState.cash_floor_usd;
    if(floor!==null&&available-strike<floor)return false;
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
    const candidates=timingAllowsEntry?(research.puts||[]).filter(candidate=>
      candidatePasses(candidate,ownerState,account.available)
    ):[];
    if(candidates.length){
      return result(
        "entry","review",
        `当前有 ${candidates.length} 个 1 BTC Sell Put 通过容量与策略筛选。`,
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
    return (research?.puts||[]).find(candidate=>
      String(candidate.expiry)===String(position.expiry)&&
      Math.abs(Number(candidate.strike)-Number(position.strike))<1e-8
    )||null;
  }

  function deribitStandardPutMargin(position,research,nowMs=Date.now()){
    if(!sourceUsable(research,nowMs))return null;
    const spot=positive(research?.spot);
    const strike=positive(position?.strike);
    const notional=positive(position?.notional_btc);
    const premium=nonNegative(position?.open_premium_per_btc);
    const quote=findQuote(position,research);
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

  function positionMetrics(position,research,nowMs=Date.now()){
    const quote=findQuote(position,research);
    const currentBid=finite(quote?.bid_usd);
    const premium=Number(position.open_premium_per_btc);
    const remainingDays=dte(position,nowMs);
    const totalDays=(dateMs(position.expiry)-dateMs(position.open_date))/DAY_MS;
    const elapsedDays=Math.max(0,(dateMs(utcDate(nowMs))-dateMs(position.open_date))/DAY_MS);
    const timeElapsedPct=totalDays<=0?(elapsedDays>0?100:0):elapsedDays/totalDays*100;
    const capturePct=currentBid===null||premium<=0?null:(premium-currentBid)/premium*100;
    const remainingApr=currentBid===null?null:annualizedSimple(
      currentBid*position.notional_btc,
      position.strike*position.notional_btc,
      remainingDays,
    );
    return {
      quote,
      current_bid:currentBid,
      capture_pct:capturePct,
      time_elapsed_pct:timeElapsedPct,
      dte:remainingDays,
      remaining_apr:remainingApr,
      net_own_capital:(position.strike-premium)*position.notional_btc,
    };
  }

  function evaluateClose(position,ownerStateValue,positions,research,nowMs=Date.now()){
    if(isExpired(position,nowMs)){
      return result("close","risk","仓位已到期，请先核对现金结算。",{
        metrics:positionMetrics(position,research,nowMs),
      });
    }
    const ownerState=normalizeOwnerState(ownerStateValue);
    const account=totals(ownerState,positions);
    if(account.available<0){
      return result(
        "close","risk",
        `Put 完整承诺超过稳定币 ${Math.abs(account.available).toLocaleString("en-US",{maximumFractionDigits:2})} USD。`,
        {metrics:positionMetrics(position,research,nowMs)},
      );
    }
    if(!sourceUsable(research,nowMs)){
      return result("close","unknown","当前 BTC 参考价已过期或不可用。",{
        metrics:positionMetrics(position,research,nowMs),
      });
    }
    const spot=positive(research?.spot);
    const metrics=positionMetrics(position,research,nowMs);
    if(spot===null||metrics.current_bid===null){
      return result("close","unknown","当前 BTC 参考价或合约 Bid 不可用。",{metrics});
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
      return result("close","review","BTC 参考价已触及或穿过这笔仓位的行权价。",{metrics});
    }
    return result(
      "close","not_due",
      "BTC 参考价尚未触及行权价，资本效率仍在门槛之上。",
      {metrics},
    );
  }

  return {
    RWA_APY,CAPTURE_EXIT,TIME_EXIT,EXIT_APR_BUFFER_PP,
    MIN_RESEARCH_DTE,MAX_RESEARCH_SPREAD_PCT,LABELS,
    finite,positive,optionalPositive,validDate,utcDate,isExpired,dte,
    normalizeOwnerState,normalizePosition,totals,sourceUsable,
    annualizedSimple,deribitStandardPutMargin,deribitCapitalSummary,
    positionMetrics,evaluateEntry,evaluateClose,
  };
});
