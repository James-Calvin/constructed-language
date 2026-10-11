(function(root){
  "use strict";
  const PREFIX="secret.dictionary-session.v1:",TTL=30000,stores=new Map();
  const rowKey=row=>JSON.stringify([row.rowId,row.timestamp]);
  const clock=()=>root.performance?.now?.()??Date.now();
  const metrics={};
  function measure(name,value=1){
    let enabled=Boolean(root.SECRET_PERFORMANCE_DEBUG);try{enabled=enabled||root.sessionStorage?.getItem("secret.performance.debug")==="1";}catch{}
    if(!enabled)return;
    // Usability is the first paint time for this page, not a sum of refreshes.
    if(name.endsWith("UsableMilliseconds")&&metrics[name]!==undefined)return;
    metrics[name]=(metrics[name]||0)+value;
    root.console?.debug?.("Language performance",name,value);
  }
  function create({client,table,scopeKey,storage,ensure=async()=>true,now=Date.now,ttl=TTL}){
    let rows=null,verifiedAt=0,inflight=null,epoch=0,revision=0,index=null,grouped=null;
    const key=PREFIX+scopeKey;
    function persist(){try{storage?.setItem(key,JSON.stringify({rows,verifiedAt}));}catch{
      // Do not leave an older persisted image looking fresh after a local save.
      try{storage?.removeItem?.(key);}catch{}
    }}
    try{
      const saved=JSON.parse(storage?.getItem(key)||"null");
      if(saved&&Array.isArray(saved.rows)&&saved.rows.every(row=>row&&typeof row.rowId==="string"&&Number.isFinite(row.timestamp))&&
        Number.isFinite(saved.verifiedAt)&&saved.verifiedAt>=0&&saved.verifiedAt<=now()){
        rows=saved.rows;verifiedAt=saved.verifiedAt;
      }
    }catch{/* Ignore malformed or inaccessible session storage. */}
    function replace(next,time){rows=next;verifiedAt=time;revision++;index=null;grouped=null;persist();}
    function indexes(){
      if(index)return index;
      const start=clock(),byWord=new Map(),byRow=new Map();
      for(const row of rows||[]){byRow.set(rowKey(row),row);if(row.word&&row.pronunciation){if(!byWord.has(row.word))byWord.set(row.word,[]);byWord.get(row.word).push(row);}}
      index={byWord,byRow};measure("indexMilliseconds",clock()-start);return index;
    }
    function fresh(){return rows!==null&&verifiedAt>0&&now()-verifiedAt<ttl;}
    async function refresh({force=false}={}){
      if(inflight)return inflight;
      if(rows!==null)measure("snapshotAgeMilliseconds",verifiedAt?now()-verifiedAt:0);
      if(!force&&fresh()){measure("cacheHits");return rows;}
      const startedEpoch=epoch,start=clock();
      inflight=(async()=>{
        if(!await ensure())throw new Error("Database access is unavailable.");
        measure("snapshotScans");const next=[];let cursor;
        do{
          const page=await client().scan({TableName:table,ConsistentRead:true,...(cursor?{ExclusiveStartKey:cursor}:{})}).promise();
          measure("snapshotPages");next.push(...(page.Items||[]));cursor=page.LastEvaluatedKey;
        }while(cursor);
        if(epoch!==startedEpoch)throw new Error("Saved data changed during refresh; retrying without replacing the current view.");
        replace(next,now());measure("snapshotMilliseconds",clock()-start);return rows;
      })().finally(()=>{inflight=null;});
      return inflight;
    }
    function invalidate(){epoch++;verifiedAt=0;persist();}
    function upsert(item){epoch++;if(rows===null)return;replace((rows||[]).filter(row=>rowKey(row)!==rowKey(item)).concat(JSON.parse(JSON.stringify(item))),verifiedAt);}
    function remove(item){epoch++;if(rows===null)return;replace(rows.filter(row=>rowKey(row)!==rowKey(item)),verifiedAt);}
    return {table,peek:()=>rows,refresh,fresh,invalidate,upsert,remove,
      matches:word=>indexes().byWord.get(word)||[],row:item=>indexes().byRow.get(rowKey(item)),
      words:()=>{if(!grouped){const start=clock();grouped=root.SECRET_MEANING_REQUESTS.groupWords(rows||[]);measure("groupMilliseconds",clock()-start);}return grouped;},
      version:()=>revision,lastVerifiedAt:()=>verifiedAt,remaining:()=>fresh()?Math.max(1,ttl-(now()-verifiedAt)):ttl,
      age:()=>verifiedAt?now()-verifiedAt:null,
      clear(){epoch++;replace(null,0);try{storage?.removeItem(key);}catch{}}
    };
  }
  function forRuntime(runtime){
    const config=runtime.awsConfig||{},username=root.SECRET_CURRENT_USER?.id;
    if(!username||!config.heartsTableName)return null;
    const key=JSON.stringify([config.region,config.identityPoolId,config.heartsTableName,username]);
    if(!stores.has(key)){
      let storage;try{storage=root.sessionStorage;}catch{}
      stores.set(key,create({client:runtime.getHeartsTableClient,table:config.heartsTableName,scopeKey:key,storage,ensure:runtime.ensureAwsCredentials}));
    }
    return stores.get(key);
  }
  function trackClient(client,getStore){
    for(const name of ["put","delete","update","batchWrite","transactWrite","scan"]){
      if(typeof client[name]!=="function")continue;
      const original=client[name].bind(client);
      client[name]=function(params,...args){
        const request=original(params,...args),promise=request.promise.bind(request);let tracked;
        request.promise=()=>tracked||(tracked=promise().then(result=>{
          if(name==="scan"){measure("databaseScanPages");return result;}
          const store=getStore();
          if(store&&params.TableName&&params.TableName!==store.table)return result;
          if(store){
            if(name==="put")store.upsert(params.Item);
            else if(name==="delete")store.remove(params.Key);
            else if(name==="update"&&result.Attributes&&params.ReturnValues==="ALL_NEW")store.upsert(result.Attributes);
            else store.invalidate();
          }
          return result;
        },error=>{if(name!=="scan")getStore()?.invalidate();throw error;}));
        return request;
      };
    }
    return client;
  }
  function clearAll(){
    for(const store of stores.values())store.clear();stores.clear();
    try{const storage=root.sessionStorage;for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(PREFIX))storage.removeItem(key);}}catch{}
  }
  const api={create,forRuntime,trackClient,clearAll,measure,metrics,TTL,PREFIX};root.SECRET_DICTIONARY_CACHE=api;
  if(typeof module!=="undefined")module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
