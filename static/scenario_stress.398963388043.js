(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.ScenarioStress=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const DAY_MS=86400000;
  const RISK_FREE_RATE=.04;
  const PRESETS=Object.freeze({
    black_thursday:{label:"黑色星期四",price_shock_pct:-30,iv_shock_points:30,time_days:0},
    slow_grind:{label:"缓慢磨人",price_shock_pct:0,iv_shock_points:0,time_days:14},
    vol_crush:{label:"波动率崩溃",price_shock_pct:0,iv_shock_points:-20,time_days:7},
    sudden_rally:{label:"突发上涨",price_shock_pct:20,iv_shock_points:-10,time_days:0},
  });

  function finite(value){
    if(value===null||value===undefined||value==="")return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function clamp(value,minimum,maximum,fallback=0){
    const number=finite(value);
    return Math.min(maximum,Math.max(minimum,number===null?fallback:number));
  }

  function normalizeScenario(value={}){
    return {
      price_shock_pct:Math.round(clamp(value.price_shock_pct,-50,50)*10)/10,
      iv_shock_points:Math.round(clamp(value.iv_shock_points,-30,30)*10)/10,
      time_days:Math.round(clamp(value.time_days,0,30)),
    };
  }

  function erf(value){
    const sign=value<0?-1:1;
    const x=Math.abs(value);
    const t=1/(1+.3275911*x);
    const polynomial=(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t;
    return sign*(1-polynomial*Math.exp(-x*x));
  }

  function normalCdf(value){return .5*(1+erf(value/Math.sqrt(2)))}

  function blackScholesPut(spotValue,strikeValue,yearsValue,ivValue,rate=RISK_FREE_RATE){
    const spot=finite(spotValue),strike=finite(strikeValue),years=finite(yearsValue),sigma=finite(ivValue);
    if(!(spot>0)||!(strike>0)||years===null||sigma===null||!(sigma>0))return null;
    if(years<=0)return Math.max(strike-spot,0);
    const root=Math.sqrt(years);
    const d1=(Math.log(spot/strike)+(rate+.5*sigma*sigma)*years)/(sigma*root);
    const d2=d1-sigma*root;
    return strike*Math.exp(-rate*years)*normalCdf(-d2)-spot*normalCdf(-d1);
  }

  function dte(expiry,nowMs=Date.now()){
    const end=Date.parse(`${String(expiry||"")}T00:00:00Z`);
    const today=Date.parse(new Date(nowMs).toISOString().slice(0,10)+"T00:00:00Z");
    return Number.isFinite(end)?Math.max(0,(end-today)/DAY_MS):null;
  }

  function sourceUsable(research,nowMs=Date.now()){
    const status=research?.source_status;
    const asof=finite(status?.chain_asof_epoch_ms);
    const ttl=finite(status?.quote_ttl_seconds);
    return Boolean(status&&status.chain_stale===false&&asof!==null&&ttl>0&&nowMs-asof>=-5000&&nowMs-asof<=ttl*1000);
  }

  function quoteFor(position,research){
    return (research?.puts||[]).find(row=>
      String(row.expiry)===String(position.expiry)&&
      Math.abs(Number(row.strike)-Number(position.strike))<1e-8
    )||null;
  }

  function normalizedIv(value){
    const iv=finite(value);
    if(iv===null||iv<=0)return null;
    return iv>3?iv/100:iv;
  }

  function hasGreeks(quote){
    return ["delta","gamma","theta","vega"].every(key=>finite(quote?.[key])!==null);
  }

  function positionScenario(position,research,scenarioValue={},nowMs=Date.now()){
    const scenario=normalizeScenario(scenarioValue);
    const quote=quoteFor(position,research);
    const spot=finite(research?.spot);
    const days=dte(position?.expiry,nowMs);
    const iv=normalizedIv(quote?.iv);
    const strike=finite(position?.strike);
    const notional=finite(position?.notional_btc);
    const premium=finite(position?.open_premium_per_btc);
    if(!sourceUsable(research,nowMs)||!(spot>0)||!(strike>0)||!(notional>0)||premium===null||days===null||iv===null||!hasGreeks(quote)){
      return {id:position?.id||null,asset:position?.asset||null,available:false,reason:"缺少新鲜报价、IV 或完整 Greeks"};
    }
    const stressedSpot=spot*(1+scenario.price_shock_pct/100);
    const stressedIv=clamp(iv+scenario.iv_shock_points/100,.01,5,.01);
    const currentValue=blackScholesPut(spot,strike,days/365,iv);
    const scenarioValuePerUnit=blackScholesPut(stressedSpot,strike,Math.max(0,days-scenario.time_days)/365,stressedIv);
    if(currentValue===null||scenarioValuePerUnit===null)return {id:position.id,asset:position.asset,available:false,reason:"模型输入不可用"};
    const currentPnl=(premium-currentValue)*notional;
    const scenarioPnl=(premium-scenarioValuePerUnit)*notional;
    return {
      id:position.id,asset:position.asset,available:true,current_pnl:currentPnl,
      scenario_pnl:scenarioPnl,change:scenarioPnl-currentPnl,current_option_value:currentValue,
      scenario_option_value:scenarioValuePerUnit,stressed_spot:stressedSpot,stressed_iv:stressedIv,
      remaining_days:Math.max(0,days-scenario.time_days),
    };
  }

  function portfolioScenario(positions,researchByAsset,scenarioValue={},nowMs=Date.now()){
    const rows=(positions||[]).map(position=>positionScenario(position,researchByAsset?.[position.asset],scenarioValue,nowMs));
    const available=rows.filter(row=>row.available);
    const unavailable=rows.filter(row=>!row.available);
    const sum=key=>available.reduce((total,row)=>total+row[key],0);
    const ordered=[...available].sort((a,b)=>a.change-b.change);
    return {
      scenario:normalizeScenario(scenarioValue),rows,available_count:available.length,
      unavailable_count:unavailable.length,current_pnl:sum("current_pnl"),
      scenario_pnl:sum("scenario_pnl"),change:sum("change"),
      worst:ordered[0]||null,best:ordered.at(-1)||null,
    };
  }

  function heatmap(positions,researchByAsset,timeDays=0,nowMs=Date.now()){
    const priceShocks=[-50,-40,-30,-20,-10,0,10,20,30,40,50];
    const ivShocks=[30,20,10,0,-10,-20,-30];
    const cells=[];
    for(const iv of ivShocks){
      for(const price of priceShocks){
        const result=portfolioScenario(positions,researchByAsset,{price_shock_pct:price,iv_shock_points:iv,time_days:timeDays},nowMs);
        cells.push({price_shock_pct:price,iv_shock_points:iv,change:result.change,available_count:result.available_count});
      }
    }
    return {price_shocks:priceShocks,iv_shocks:ivShocks,cells,time_days:normalizeScenario({time_days:timeDays}).time_days};
  }

  return {
    PRESETS,finite,clamp,normalizeScenario,normalCdf,blackScholesPut,dte,
    sourceUsable,quoteFor,normalizedIv,hasGreeks,positionScenario,portfolioScenario,heatmap,
  };
});
