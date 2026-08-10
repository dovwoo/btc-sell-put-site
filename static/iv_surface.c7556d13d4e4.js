(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.IvSurface=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function finite(value){
    if(value===null||value===undefined||value==="")return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function activateIvSurfaceRoute(documentNode,pathname){
    if(!documentNode||!/\/options\/iv-surface\/?$/.test(String(pathname||"")))return false;
    documentNode.documentElement?.classList?.add("iv-surface-route");
    return true;
  }

  function median(values){
    const rows=(values||[]).map(finite).filter(value=>value!==null).sort((a,b)=>a-b);
    if(!rows.length)return null;
    const middle=Math.floor(rows.length/2);
    return rows.length%2?rows[middle]:(rows[middle-1]+rows[middle])/2;
  }

  function normalizeRows(rows,side,expiry,dte){
    return (rows||[]).map(row=>({
      side,expiry,dte,
      strike:finite(row?.strike),
      delta:finite(row?.delta),
      iv:finite(row?.iv),
    })).filter(row=>row.strike!==null&&row.strike>0&&row.iv!==null&&row.iv>0);
  }

  function optionExpiries(putPayload,callPayload){
    const dates=new Set([
      ...Object.keys(putPayload?.expiries||{}),
      ...Object.keys(callPayload?.expiries||{}),
    ]);
    return [...dates].map(expiry=>{
      const putGroup=putPayload?.expiries?.[expiry]||{};
      const callGroup=callPayload?.expiries?.[expiry]||{};
      const dte=finite(putGroup.days)??finite(callGroup.days);
      return {
        expiry,dte,
        puts:normalizeRows(putGroup.puts,"put",expiry,dte),
        calls:normalizeRows(callGroup.calls,"call",expiry,dte),
      };
    }).filter(row=>row.dte!==null&&(row.puts.length||row.calls.length))
      .sort((a,b)=>a.dte-b.dte||a.expiry.localeCompare(b.expiry));
  }

  function nearestExpiry(expiries,targetDte=30){
    const target=finite(targetDte)??30;
    return (expiries||[]).reduce((best,row)=>{
      if(!best)return row;
      const distance=Math.abs(row.dte-target);
      const bestDistance=Math.abs(best.dte-target);
      return distance<bestDistance||(distance===bestDistance&&row.dte<best.dte)?row:best;
    },null);
  }

  function nearestRowsToSpot(rows,spot){
    const reference=finite(spot);
    if(reference===null||reference<=0||!(rows||[]).length)return [];
    const distances=rows.map(row=>Math.abs(row.strike-reference));
    const minimum=Math.min(...distances);
    return rows.filter((_,index)=>Math.abs(distances[index]-minimum)<1e-9);
  }

  function atmIv(expiry,spot){
    if(!expiry)return null;
    const values=[
      ...nearestRowsToSpot(expiry.puts,spot),
      ...nearestRowsToSpot(expiry.calls,spot),
    ].map(row=>row.iv);
    return median(values);
  }

  function nearestDeltaIv(rows,targetDelta){
    const target=finite(targetDelta);
    const candidates=(rows||[]).filter(row=>row.delta!==null&&row.iv!==null);
    if(target===null||!candidates.length)return null;
    return candidates.reduce((best,row)=>
      !best||Math.abs(row.delta-target)<Math.abs(best.delta-target)?row:best,null)?.iv??null;
  }

  function smile(expiry,xMode="strike"){
    if(!expiry)return {expiry:null,dte:null,puts:[],calls:[]};
    const convert=rows=>rows.map(row=>({
      x:xMode==="delta"?row.delta:row.strike,
      strike:row.strike,delta:row.delta,iv:row.iv,
    })).filter(row=>row.x!==null).sort((a,b)=>a.x-b.x);
    return {expiry:expiry.expiry,dte:expiry.dte,puts:convert(expiry.puts),calls:convert(expiry.calls)};
  }

  function termStructure(expiries,spot){
    return (expiries||[]).map(expiry=>({
      expiry:expiry.expiry,dte:expiry.dte,iv:atmIv(expiry,spot),
    })).filter(row=>row.iv!==null).sort((a,b)=>a.dte-b.dte);
  }

  function nearestTermPoint(points,targetDte){
    return (points||[]).reduce((best,row)=>
      !best||Math.abs(row.dte-targetDte)<Math.abs(best.dte-targetDte)?row:best,null);
  }

  function classifyCurve(shortIv,longIv){
    const front=finite(shortIv);
    const back=finite(longIv);
    if(front===null||back===null)return "unavailable";
    const spread=front-back;
    if(spread>2)return "backwardation";
    if(spread<-2)return "contango";
    return "flat";
  }

  function metrics(expiries,spot,selectedExpiry){
    const selected=selectedExpiry||nearestExpiry(expiries,30);
    const atm=atmIv(selected,spot);
    const put10=nearestDeltaIv(selected?.puts,-.10);
    const put25=nearestDeltaIv(selected?.puts,-.25);
    const call25=nearestDeltaIv(selected?.calls,.25);
    const term=termStructure(expiries,spot);
    const seven=nearestTermPoint(term,7);
    const thirty=nearestTermPoint(term,30);
    const ninety=nearestTermPoint(term,90);
    return {
      expiry:selected?.expiry||null,dte:selected?.dte??null,atm_iv:atm,
      put_10d_skew:put10===null||atm===null?null:put10-atm,
      risk_reversal_25d:put25===null||call25===null?null:put25-call25,
      term_points:{d7:seven,d30:thirty,d90:ninety},
      curve:classifyCurve(seven?.iv,ninety?.iv),
      term,
    };
  }

  if(typeof document!=="undefined")activateIvSurfaceRoute(document,location.pathname);

  return {
    finite,median,optionExpiries,nearestExpiry,nearestRowsToSpot,atmIv,
    nearestDeltaIv,smile,termStructure,nearestTermPoint,classifyCurve,metrics,activateIvSurfaceRoute,
  };
});
