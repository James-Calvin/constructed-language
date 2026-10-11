(function (root) {
  "use strict";
  const types = {
    derived: ["Derived from", "Derived words"], compound: ["Compound of", "Used in compounds"],
    prefix: ["Uses prefix", "Prefix in"], suffix: ["Uses suffix", "Suffix in"],
    variant: ["Variant of", "Variant of"], related: ["Related to", "Related to"]
  };
  const symmetric = type => type === "variant" || type === "related";
  const clean = value => String(value || "").trim();
  const spelling = value => clean(value).replace(/[.-]/g, "");
  const key = item => `${item.rowId}|${item.timestamp}`;
  function edgeId(from, to, type) {
    const ends = symmetric(type) ? [from, to].sort() : [from, to];
    return `__secret_relation__::${encodeURIComponent(JSON.stringify([type, ...ends]))}`;
  }
  function validateLink(from, to, type) {
    if (!types[type]) throw new Error("Choose a relationship type.");
    if (!from || !to || from === to) throw new Error("Choose two different words or inventory entries.");
  }
  function assemble(parts) { return parts.map(part => spelling(part.spelling)).join(""); }
  function senses(meaning) { return [...new Set(String(meaning || "").split(/[,;]/).map(clean).filter(Boolean))]; }
  function literal(parts) { return parts.length && parts.every(part => clean(part.sense)) ? parts.map(part => clean(part.sense)).join(" + ") : ""; }
  function position(index, length) { return index === 0 ? "prefix" : index === length - 1 ? "suffix" : "root"; }
  function usageCounts(recipes, resolve) {
    const counts = new Map();
    for (const recipe of recipes) {
      const data = recipe.recipeData;
      if (!resolve(data.result)) continue;
      data.parts.forEach((part, index) => {
        if (!resolve(part.id)) return;
        if (!counts.has(part.id)) counts.set(part.id, {prefix:0, root:0, suffix:0});
        counts.get(part.id)[position(index, data.parts.length)]++;
      });
    }
    return counts;
  }
  function preview(word, ipa, config, rules) {
    const derivation = rules.derivePronunciationFromSpelling({ spelling: word, config });
    const analysis = rules.analyzeEntryAgainstRuleConfig({ word: spelling(word), pronunciation: ipa, config });
    return { spelling: spelling(word), pronunciation: derivation.pronunciation || "",
      warnings: [...new Set([...(derivation.warnings || []), ...(analysis.warnings || []),
        ...(!analysis.available ? ["The active rules cannot verify this word."] : [])])] };
  }
  function create({ client, table, user }) {
    let rows = [], revision = 0, pending = 0, cached={};
    const requests = root.SECRET_MEANING_REQUESTS.create({ client, table, user });
    function load(raw) { rows = raw; cached={};requests.load(raw); }
    function indexes(){
      if(!cached.indexes){
        const start=root.performance?.now?.()??Date.now(),grouped=root.SECRET_MEANING_REQUESTS.groupWords(rows);
        cached.indexes={words:grouped,byWord:new Map(grouped.map(word=>[word.word,word])),byId:new Map(rows.map(row=>[row.rowId,row])),byKey:new Map(rows.map(row=>[key(row),row])),resolved:new Map()};
        root.SECRET_DICTIONARY_CACHE?.measure("relationshipIndexMilliseconds",(root.performance?.now?.()??Date.now())-start);
      }
      return cached.indexes;
    }
    const words = () => indexes().words;
    const inventory = () => cached.inventory||(cached.inventory=rows.filter(row => row.morphemeData && !row.morphemeData.deleted).sort((a,b) => a.morphemeData.spelling.localeCompare(b.morphemeData.spelling)));
    function resolve(id,visiting=new Set()) {
      const index=indexes();if(index.resolved.has(id))return index.resolved.get(id);if(visiting.has(id))return null;visiting.add(id);
      const value=resolveUncached(id,visiting);index.resolved.set(id,value);return value;
    }
    function resolveUncached(id,visiting) {
      const index=indexes(),row = index.byId.get(id);
      if (row?.morphemeData && !row.morphemeData.deleted) {
        const data = row.morphemeData;
        const counterpart = data.counterpartId ? resolve(data.counterpartId,visiting) : index.byWord.get(data.spelling);
        return { id, kind: data.kind, spelling: counterpart?.spelling || counterpart?.word || data.spelling,
          pronunciation: counterpart?.pronunciation || data.pronunciation, meaning: counterpart?.meaning || data.meaning,
          category: counterpart?.category || (counterpart ? root.SECRET_DEFINITIONS.classification(counterpart) : "root-only"), row, counterpart };
      }
      if (!row?.lexemeData || row.lexemeData.deleted) return null;
      const data = row.lexemeData;
      const source = index.byKey.get(key(data.source));
      const word = index.byWord.get(source?.word || data.spelling);
      return word ? { id, kind: "word", spelling: word.word, pronunciation: word.pronunciation,
        meaning: word.meaning || "", category: root.SECRET_DEFINITIONS.classification(word), row, word } : null;
    }
    function choices() {
      if(cached.choices)return cached.choices;
      const nodes=new Map();for(const row of rows){if(row.lexemeData){const endpoint=resolve(row.rowId);if(endpoint&&!nodes.has(endpoint.spelling))nodes.set(endpoint.spelling,row.rowId);}}
      return cached.choices=inventory().map(item => resolve(item.rowId)).filter(Boolean).concat(words().map(word => ({
        kind: "word", spelling: word.word, pronunciation: word.pronunciation, meaning: word.meaning || "",
        category: root.SECRET_DEFINITIONS.classification(word), word,
        id: nodes.get(word.word) || ""
      }))).sort((a,b) => a.spelling.localeCompare(b.spelling));
    }
    function recipes() { return cached.recipes||(cached.recipes=rows.filter(row => row.recipeData && !row.recipeData.deleted)); }
    function recipeFor(id) { if(!cached.recipeByResult)cached.recipeByResult=new Map(recipes().map(row=>[row.recipeData.result,row]));return cached.recipeByResult.get(id)||null; }
    function counts() { return cached.counts||(cached.counts=usageCounts(recipes(), resolve)); }
    function relationships(id) {
      if(!cached.relationships)cached.relationships=new Map();if(cached.relationships.has(id))return cached.relationships.get(id);
      if(!cached.edges){cached.edges=new Map();for(const row of rows){if(!row.relationshipData)continue;for(const endpoint of new Set([row.relationshipData.from,row.relationshipData.to])){if(!cached.edges.has(endpoint))cached.edges.set(endpoint,[]);cached.edges.get(endpoint).push(row);}}}
      const manual = (cached.edges.get(id)||[])
        .map(row => { const data = row.relationshipData; const outgoing = data.from === id;
          return { row, data, label: types[data.type]?.[outgoing ? 0 : 1] || data.type,
            target: resolve(outgoing ? data.to : data.from) }; }).filter(edge => edge.target)
        .sort((a,b) => (a.data.order || 0) - (b.data.order || 0) || a.target.spelling.localeCompare(b.target.spelling));
      const generated = [];
      if(!cached.incidentRecipes){cached.incidentRecipes=new Map();for(const row of recipes()){for(const endpoint of new Set([row.recipeData.result,...row.recipeData.parts.map(part=>part.id)])){if(!cached.incidentRecipes.has(endpoint))cached.incidentRecipes.set(endpoint,[]);cached.incidentRecipes.get(endpoint).push(row);}}}
      for (const row of cached.incidentRecipes.get(id)||[]) {
        const recipe = row.recipeData;
        if (!resolve(recipe.result)) continue;
        recipe.parts.forEach((part, index) => {
          if (recipe.result !== id && part.id !== id) return;
          const targetId = recipe.result === id ? part.id : recipe.result;
          if (manual.some(edge => edge.target.id === targetId && ["compound","prefix","suffix"].includes(edge.data.type))) return;
          const target = resolve(targetId) || (recipe.result === id ? {...part, kind:"unavailable", pronunciation:part.pronunciation || "", meaning:part.meaning || ""} : null);
          if (target) generated.push({row, recipe:true, target, label:recipe.result === id ? `Compound of (${position(index,recipe.parts.length)}${resolve(part.id)?"":", unavailable"})` : `Used as ${position(index,recipe.parts.length)} in`,
            data:{...recipe,type:"compound",order:index,explanation:part.sense || ""}});
        });
      }
      const result=manual.concat(generated);cached.relationships.set(id,result);return result;
    }
    async function saveRecipe({result, parts, base=null, operationId}) {
      load(await read());
      if (!user() || !resolve(result)) throw new Error("The result word is unavailable.");
      if (parts.length < 2) throw new Error("Choose at least two components.");
      if (parts.some(part => !resolve(part.id) || part.id === result || resolve(part.id).spelling === resolve(result).spelling)) throw new Error("Replace unavailable components; a word cannot contain itself.");
      operationId=operationId||root.crypto.randomUUID();
      const id = `__secret_recipe__::${encodeURIComponent(result)}`;
      const existing = rows.find(row => row.rowId === id);
      // A lost response can be retried without rewriting or double-counting the recipe.
      if (existing?.recipeData.operationId === operationId && operationId) return existing;
      const previous = base ? await fresh(base,"recipeData") : null;
      if (existing && !base) throw new Error("A composition already exists. Reopen it and confirm replacement.");
      if (base && (base.rowId !== id || previous.recipeData.result !== result)) throw new Error("The composition target changed. Reopen it.");
      const snapshots = parts.map(part => {
        const current=resolve(part.id);
        return {instanceId:part.instanceId || root.crypto.randomUUID(),id:part.id,spelling:current.spelling,
          pronunciation:current.pronunciation,meaning:part.meaning || "",sense:clean(part.sense)};
      });
      return write({rowId:id,timestamp:0,recipeData:{result,parts:snapshots,literal:literal(snapshots),operationId,...attribution(previous?.recipeData)}},"recipeData",previous);
    }
    async function read() {
      const raw = []; let cursor;
      do { const page = await client().scan({ TableName: table, ConsistentRead: true,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }).promise(); raw.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
      } while (cursor);
      return raw;
    }
    function remember(item) { load(rows.filter(row => key(row) !== key(item)).concat(item)); }
    function forgetWord(word) {
      load(rows.flatMap(row=>row.word!==word?[row]:row.conceptData?[{rowId:row.rowId,timestamp:row.timestamp,conceptData:row.conceptData}]:[]));
    }
    async function fresh(item, field) {
      const result = await client().get({ TableName: table, Key: {rowId:item.rowId,timestamp:item.timestamp}, ConsistentRead:true }).promise();
      if (!result.Item || root.SECRET_COOPERATIVE_REFRESH.fingerprint([result.Item[field]]) !== root.SECRET_COOPERATIVE_REFRESH.fingerprint([item[field]])) {
        throw new Error("This entry changed. Refresh and reopen it; your draft is retained.");
      }
      return result.Item;
    }
    async function write(item, field, previous) {
      if (!user()) throw new Error("A named user is required.");
      revision++; pending++;
      const condition = previous ? { ConditionExpression:"#data = :data", ExpressionAttributeNames:{"#data":field},
        ExpressionAttributeValues:{":data":previous[field]} } : {ConditionExpression:"attribute_not_exists(rowId)"};
      try { await client().put({TableName:table,Item:item,...condition}).promise(); remember(item); return item; }
      finally { pending--; revision++; }
    }
    function attribution(previous) {
      return { author: previous?.author || user(), createdAt: previous?.createdAt || Date.now(),
        editedBy:user(), editedAt:Math.max(Date.now(), (previous?.editedAt || 0)+1) };
    }
    async function saveInventory(values, base) {
      const data = {kind:values.kind,spelling:spelling(values.spelling),pronunciation:clean(values.pronunciation),meaning:clean(values.meaning),notes:clean(values.notes)};
      if (!["root","prefix","suffix"].includes(data.kind) || !data.spelling || !data.pronunciation || data.meaning.length>2000 || data.notes.length>4000) throw new Error("Enter a type, spelling and IPA; meaning is limited to 2000 and notes to 4000 characters.");
      const previous = base ? await fresh(base,"morphemeData") : null;
      const item = {rowId:base?.rowId || `__secret_morpheme__::${root.crypto.randomUUID()}`,timestamp:0,
        morphemeData:{...previous?.morphemeData,...data,...attribution(previous?.morphemeData)}};
      if(previous && (data.spelling!==previous.morphemeData.spelling || data.pronunciation!==previous.morphemeData.pronunciation))delete item.morphemeData.counterpartId;
      return write(item,"morphemeData",previous);
    }
    async function ensureWord(word) {
      const current = words().find(item=>item.word===word);
      if (!current) throw new Error("This word is no longer in the dictionary. Refresh and choose again.");
      const existing = rows.find(item=>item.lexemeData && resolve(item.rowId)?.spelling===word);
      if (existing) return existing.rowId;
      let id = `__secret_lexeme__::${encodeURIComponent(word)}`;
      if (rows.some(row=>row.rowId===id)) id += `::${encodeURIComponent(current.rowId)}::${current.timestamp}`;
      const item={rowId:id,timestamp:0,lexemeData:{spelling:word,source:{rowId:current.rowId,timestamp:current.timestamp},...attribution()}};
      try {await write(item,"lexemeData");} catch(error) {
        if(error.code!=="ConditionalCheckFailedException") throw error;
        load(await read());
        const winner=rows.find(row=>row.lexemeData && resolve(row.rowId)?.spelling===word);
        if(!winner) throw new Error("Word identity changed. Refresh and try again.");
        return winner.rowId;
      }
      return id;
    }
    async function link(from,to,type,explanation="",order=0,base=null,idempotent=true) {
      validateLink(from,to,type);
      load(await read());
      const previous = base ? await fresh(base,"relationshipData") : null;
      const id=edgeId(from,to,type);
      if(!resolve(from)||!resolve(to)) throw new Error("A relationship endpoint no longer exists. Refresh and choose again.");
      if(clean(explanation).length>2000) throw new Error("Relationship explanations are limited to 2000 characters.");
      const item={rowId:id,timestamp:0,relationshipData:{from,to,type,explanation:clean(explanation),order:Number(order)||0,...attribution(previous?.relationshipData)}};
      if(base && id!==base.rowId) {
        const duplicate=rows.find(row=>row.rowId===id);
        if(duplicate && (duplicate.relationshipData.author!==item.relationshipData.author || duplicate.relationshipData.explanation!==item.relationshipData.explanation)) {
          throw new Error("That relationship already exists. Remove the old link instead of replacing the existing one.");
        }
        if(!duplicate)await write(item,"relationshipData");
        try{await removeLink(previous);}catch(error){throw new Error(`Changed relationship saved; old link cleanup pending. Retry this edit. ${error.message}`);}
        return duplicate||item;
      }
      if(!base) {
        const found=rows.find(row=>row.rowId===id);
        if(found) {if(!idempotent)throw new Error("That relationship already exists.");return found;}
      }
      try {return await write(item,"relationshipData",previous);} catch(error) {
        if(!base && error.code==="ConditionalCheckFailedException") {
          const found=(await client().get({TableName:table,Key:{rowId:id,timestamp:0},ConsistentRead:true}).promise()).Item;
          if(found?.relationshipData) {if(!idempotent)throw new Error("That relationship already exists.");remember(found);return found;}
        }
        throw error;
      }
    }
    async function removeLink(base) {
      if(!user())throw new Error("A named user is required.");
      const previous=await fresh(base,"relationshipData"); pending++;revision++;
      try {await client().delete({TableName:table,Key:{rowId:base.rowId,timestamp:0},ConditionExpression:"#data = :data",
        ExpressionAttributeNames:{"#data":"relationshipData"},ExpressionAttributeValues:{":data":previous.relationshipData}}).promise();
        load(rows.filter(row=>row.rowId!==base.rowId));
      } finally {pending--;revision++;}
    }
    async function removeNode(base, field) {
      const previous=await fresh(base,field);
      // Delete links first so a failed cleanup leaves a visible, retryable entry.
      for(const edge of rows.filter(row=>row.relationshipData && [row.relationshipData.from,row.relationshipData.to].includes(base.rowId))) await removeLink(edge);
      for(const recipe of recipes().filter(row=>row.recipeData.result===base.rowId)) {
        const current=await fresh(recipe,"recipeData");
        await write({...current,recipeData:{...current.recipeData,deleted:true,...attribution(current.recipeData)}},"recipeData",current);
      }
      const tombstone=await write({...previous,[field]:{...previous[field],deleted:true,...attribution(previous[field])}},field,previous);
      return tombstone;
    }
    async function removeWord(word) {
      for(const row of rows.filter(item=>item.lexemeData && resolve(item.rowId)?.spelling===word)) await removeNode(row,"lexemeData");
    }
    async function renameWord(oldWord,newWord) {
      for(const row of rows.filter(item=>item.lexemeData && item.lexemeData.spelling===oldWord && !item.lexemeData.deleted)) {
        const previous=await fresh(row,"lexemeData");
        await write({...previous,lexemeData:{...previous.lexemeData,spelling:newWord,...attribution(previous.lexemeData)}},"lexemeData",previous);
      }
    }
    async function saveWord({word,pronunciation,meaning="",request=null,useExisting=false,operationId}) {
      word=spelling(word);pronunciation=clean(pronunciation);meaning=clean(meaning);
      if(!word||!pronunciation||!user()) throw new Error("Spelling, IPA and a named user are required.");
      if(meaning.length>2000)throw new Error("Definitions are limited to 2000 characters.");
      load(await read());
      const existing=words().find(item=>item.word===word);
      if(existing&&!useExisting) throw new Error("This spelling already exists. Choose Use existing word or change the spelling.");
      if(useExisting&&!existing)throw new Error("This word no longer exists. Refresh and choose again.");
      let item;
      if(request&&!useExisting) item=await requests.assign(request,word,pronunciation,{hearted:true});
      else {
        const own=existing?.records.filter(row=>row.user===user()).sort((a,b)=>(b.updatedTimestamp||b.timestamp)-(a.updatedTimestamp||a.timestamp))[0];
        const now=Date.now();
        item=useExisting&&own?{...own,hearted:true,unheartedTimestamp:null,updatedTimestamp:now}:
          {rowId:`__secret_built_word__::${operationId || root.crypto.randomUUID()}`,timestamp:now,word,
            pronunciation:useExisting?existing.pronunciation:pronunciation,meaning:useExisting?null:meaning||null,
            meaningUpdatedTimestamp:meaning&&!useExisting?now:null,user:user(),hearted:true,unheartedTimestamp:null,updatedTimestamp:now};
        await root.SECRET_DEFINITIONS.save(client(),table,item,{heartAction:true,...(!useExisting?{editor:user()}:{})});
      }
      remember(item);revision++;
      return item;
    }
    async function connect(base,word) {
      load(await read());
      const previous=await fresh(base,"morphemeData");
      const counterpartId=await ensureWord(word);
      return write({...previous,morphemeData:{...previous.morphemeData,counterpartId,...attribution(previous.morphemeData)}},"morphemeData",previous);
    }
    async function promote(base,meaning=base.morphemeData.meaning) {
      const previous=await fresh(base,"morphemeData"),data=previous.morphemeData;
      if(!clean(meaning))throw new Error("Enter a definition for the candidate root.");
      const item=await saveWord({word:data.spelling,pronunciation:data.pronunciation,meaning,operationId:`promote-${base.rowId}`});
      try{await connect(previous,item.word);}catch(error){throw new Error(`Candidate saved; connection pending. Click Connect existing word to retry. ${error.message}`);}
      return item;
    }
    return {load,read,remember,forgetWord,words,inventory,choices,resolve,relationships,recipes,recipeFor,counts,saveRecipe,saveInventory,ensureWord,link,removeLink,promote,
      removeInventory:base=>removeNode(base,"morphemeData"),removeWord,renameWord,saveWord,connect,
      requests,version:()=>revision,isBusy:()=>pending>0};
  }
  root.SECRET_RELATIONSHIPS={types,edgeId,validateLink,assemble,senses,literal,position,usageCounts,preview,create};
  if(typeof module!=="undefined") module.exports=root.SECRET_RELATIONSHIPS;
})(typeof window!=="undefined"?window:globalThis);
