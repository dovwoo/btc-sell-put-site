(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.PortfolioRisk=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const DAY_MS=86400000;
  const ASSETS=["BTC","ETH","HYPE"];
  const RISK_FREE_RATE=.04;

  function finite(value){
    if(value===null||value===undefined||value==="")return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function positive(value){
    const number=finite(value);
    return number!==null&&number>0?number:null;
  }

  function utcDate(nowMs=Date.now()){
    return new Date(nowMs).toISOString().slice(0,10);
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
    return (research?.puts||[]).find(row=>
      String(row.expiry)===String(position.expiry)&&
      Math.abs(Number(row.strike)-Number(position.strike))<1e-8
    )||null;
  }

  function groupedPositions(positions){
    const grouped=Object.fromEntries(ASSETS.map(asset=>[asset,[]]));
    for(const position of positions||[]){
      const asset=String(position?.asset||"").toUpperCase();
      if(grouped[asset])grouped[asset].push(position);
    }
    return grouped;
  }

  function deltaLedger(ownerState,positions,researchByAsset,nowMs=Date.now()){
    const stablecoin=finite(ownerState?.stablecoin_usd);
    const grouped=groupedPositions(positions);
    const rows=ASSETS.filter(asset=>grouped[asset].length).map(asset=>{
      const assetPositions=grouped[asset];
      const research=researchByAsset?.[asset];
      const spot=sourceUsable(research,nowMs)?positive(research?.spot):null;
      const deltas=assetPositions.map(position=>finite(findQuote(position,research)?.delta));
      const available=spot!==null&&deltas.every(value=>value!==null);
      const equivalentUnits=available?assetPositions.reduce(
        (sum,position,index)=>sum+deltas[index]*Number(position.notional_btc),0,
      ):null;
      const equivalentUsd=equivalentUnits===null?null:equivalentUnits*spot;
      return {
        asset,position_count:assetPositions.length,available,spot,
        equivalent_units:equivalentUnits,equivalent_usd:equivalentUsd,
        stablecoin_pct:equivalentUsd!==null&&stablecoin>0?equivalentUsd/stablecoin*100:null,
      };
    });
    const unavailableAssets=rows.filter(row=>!row.available).map(row=>row.asset);
    const knownEquivalentUsd=rows.reduce(
      (sum,row)=>sum+(row.equivalent_usd===null?0:row.equivalent_usd),0,
    );
    return {
      rows,position_count:(positions||[]).length,available:unavailableAssets.length===0,
      unavailable_assets:unavailableAssets,known_equivalent_usd:knownEquivalentUsd,
      equivalent_usd:unavailableAssets.length?null:knownEquivalentUsd,
      stablecoin_pct:unavailableAssets.length||!(stablecoin>0)
        ?null:knownEquivalentUsd/stablecoin*100,
    };
  }

  function expiryLadder(positions){
    const buckets=new Map();
    for(const position of positions||[]){
      const expiry=String(position.expiry||"");
      if(!buckets.has(expiry))buckets.set(expiry,{
        expiry,total:0,position_count:0,by_asset:Object.fromEntries(ASSETS.map(asset=>[asset,0])),
      });
      const bucket=buckets.get(expiry);
      const capital=Number(position.strike)*Number(position.notional_btc);
      bucket.total+=capital;
      bucket.position_count+=1;
      if(Object.hasOwn(bucket.by_asset,position.asset))bucket.by_asset[position.asset]+=capital;
    }
    const rows=[...buckets.values()].sort((a,b)=>a.expiry.localeCompare(b.expiry));
    const total=rows.reduce((sum,row)=>sum+row.total,0);
    for(const row of rows)row.portfolio_pct=total>0?row.total/total*100:null;
    return {rows,total,position_count:(positions||[]).length};
  }

  function strikeLadders(positions,researchByAsset,nowMs=Date.now()){
    const grouped=groupedPositions(positions);
    return ASSETS.filter(asset=>grouped[asset].length).map(asset=>{
      const buckets=new Map();
      for(const position of grouped[asset]){
        const strike=Number(position.strike);
        const existing=buckets.get(strike)||{strike,capital:0,position_count:0};
        existing.capital+=strike*Number(position.notional_btc);
        existing.position_count+=1;
        buckets.set(strike,existing);
      }
      const research=researchByAsset?.[asset];
      const spot=sourceUsable(research,nowMs)?positive(research?.spot):null;
      const rows=[...buckets.values()].sort((a,b)=>a.strike-b.strike).map(row=>({
        ...row,moneyness:spot===null?"unknown":row.strike<spot?"otm":"itm",
      }));
      return {asset,spot,spot_available:spot!==null,rows,total:rows.reduce((sum,row)=>sum+row.capital,0)};
    });
  }

  function erf(value){
    const sign=value<0?-1:1;
    const x=Math.abs(value);
    const t=1/(1+.3275911*x);
    const polynomial=(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t;
    return sign*(1-polynomial*Math.exp(-x*x));
  }

  function normalCdf(value){
    return .5*(1+erf(value/Math.sqrt(2)));
  }

  function blackScholesPut(spotValue,strikeValue,yearsValue,ivValue,rate=RISK_FREE_RATE){
    const spot=positive(spotValue);
    const strike=positive(strikeValue);
    const years=finite(yearsValue);
    let sigma=positive(ivValue);
    if(spot===null||strike===null||years===null||sigma===null)return null;
    if(sigma>3)sigma/=100;
    if(!(sigma>0))return null;
    if(years<=0)return Math.max(strike-spot,0);
    const rootYears=Math.sqrt(years);
    const d1=(Math.log(spot/strike)+(rate+.5*sigma*sigma)*years)/(sigma*rootYears);
    const d2=d1-sigma*rootYears;
    return strike*Math.exp(-rate*years)*normalCdf(-d2)-spot*normalCdf(-d1);
  }

  function remainingYears(expiry,nowMs=Date.now()){
    const expiryMs=dateMs(expiry);
    const todayMs=dateMs(utcDate(nowMs));
    if(expiryMs===null||todayMs===null)return null;
    return Math.max(0,(expiryMs-todayMs)/DAY_MS)/365;
  }

  function stressAtShock(positions,researchByAsset,shockPct,nowMs=Date.now()){
    const shock=finite(shockPct);
    if(shock===null||shock<=-100||shock>100)return null;
    const grouped=groupedPositions(positions);
    const byAsset=[];
    let worstPosition=null;
    for(const asset of ASSETS.filter(name=>grouped[name].length)){
      const research=researchByAsset?.[asset];
      const spot=sourceUsable(research,nowMs)?positive(research?.spot):null;
      let pnl=0;
      let available=spot!==null;
      const details=[];
      let assetWorst=null;
      if(available){
        for(const position of grouped[asset]){
          const quote=findQuote(position,research);
          const iv=finite(quote?.iv);
          const years=remainingYears(position.expiry,nowMs);
          const stressedSpot=spot*(1+shock/100);
          const value=blackScholesPut(stressedSpot,position.strike,years,iv);
          if(value===null){available=false;break}
          const positionPnl=(Number(position.open_premium_per_btc)-value)*Number(position.notional_btc);
          const detail={id:position.id,asset,pnl:positionPnl,stressed_spot:stressedSpot,option_value:value};
          details.push(detail);
          pnl+=positionPnl;
          if(!assetWorst||positionPnl<assetWorst.pnl)assetWorst=detail;
        }
      }
      if(available&&assetWorst&&(!worstPosition||assetWorst.pnl<worstPosition.pnl)){
        worstPosition=assetWorst;
      }
      byAsset.push({asset,available,pnl:available?pnl:null,details:available?details:[]});
    }
    const unavailableAssets=byAsset.filter(row=>!row.available).map(row=>row.asset);
    const knownTotal=byAsset.reduce((sum,row)=>sum+(row.pnl===null?0:row.pnl),0);
    return {
      shock_pct:shock,by_asset:byAsset,available:unavailableAssets.length===0,
      unavailable_assets:unavailableAssets,known_total_pnl:knownTotal,
      total_pnl:unavailableAssets.length?null:knownTotal,worst_position:worstPosition,
    };
  }

  function normalizeRange(value){
    const number=finite(value);
    if(number===null)return 30;
    return Math.round(Math.min(100,Math.max(1,Math.abs(number)))*10)/10;
  }

  function stressPortfolio(positions,researchByAsset,rangeValue=30,nowMs=Date.now()){
    const range=normalizeRange(rangeValue);
    const shocks=[-range,-range*.75,-range*.5,-range*.25,0,range*.25,range*.5,range*.75,range]
      .map(value=>Math.round(value*10)/10);
    const points=shocks.map(shock=>stressAtShock(positions,researchByAsset,shock,nowMs));
    const knownPoints=points.filter(Boolean);
    const worstPoint=knownPoints.reduce((worst,row)=>
      !worst||row.known_total_pnl<worst.known_total_pnl?row:worst,null);
    return {range,points:knownPoints,worst_point:worstPoint,position_count:(positions||[]).length};
  }

  return {
    ASSETS,RISK_FREE_RATE,finite,positive,sourceUsable,findQuote,
    deltaLedger,expiryLadder,strikeLadders,normalCdf,blackScholesPut,
    remainingYears,normalizeRange,stressAtShock,stressPortfolio,
  };
});
