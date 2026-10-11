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
  function preview(word, ipa, config, rules) {
    const derivation = rules.derivePronunciationFromSpelling({ spelling: word, config });
    const analysis = rules.analyzeEntryAgainstRuleConfig({ word: spelling(word), pronunciation: ipa, config });
    return { spelling: spelling(word), pronunciation: derivation.pronunciation || "",
      warnings: [...new Set([...(derivation.warnings || []), ...(analysis.warnings || []),
        ...(!analysis.available ? ["The active rules cannot verify this word."] : [])])] };
  }
  function create({ client, table, user }) {
    let rows = [], revision = 0, pending = 0;
    const requests = root.SECRET_MEANING_REQUESTS.create({ client, table, user });
    function load(raw) { rows = raw; requests.load(raw); }
    const words = () => root.SECRET_MEANING_REQUESTS.groupWords(rows);
    const inventory = () => rows.filter(row => row.morphemeData && !row.morphemeData.deleted).sort((a,b) => a.morphemeData.spelling.localeCompare(b.morphemeData.spelling));
    function resolve(id) {
      const row = rows.find(item => item.rowId === id);
      if (row?.morphemeData && !row.morphemeData.deleted) {
        const data = row.morphemeData;
        const counterpart = data.counterpartId ? resolve(data.counterpartId) : words().find(word => word.word === data.spelling);
        return { id, kind: data.kind, spelling: counterpart?.spelling || counterpart?.word || data.spelling,
          pronunciation: counterpart?.pronunciation || data.pronunciation, meaning: counterpart?.meaning || data.meaning,
          category: counterpart?.category || (counterpart ? root.SECRET_DEFINITIONS.classification(counterpart) : "root-only"), row, counterpart };
      }
      if (!row?.lexemeData || row.lexemeData.deleted) return null;
      const data = row.lexemeData;
      const source = rows.find(item => item.rowId === data.source.rowId && item.timestamp === data.source.timestamp && item.word);
      const word = words().find(item => item.word === (source?.word || data.spelling));
      return word ? { id, kind: "word", spelling: word.word, pronunciation: word.pronunciation,
        meaning: word.meaning || "", category: root.SECRET_DEFINITIONS.classification(word), row, word } : null;
    }
    function choices() {
      return inventory().map(item => resolve(item.rowId)).concat(words().map(word => ({
        kind: "word", spelling: word.word, pronunciation: word.pronunciation, meaning: word.meaning || "",
        category: root.SECRET_DEFINITIONS.classification(word), word,
        id: rows.find(item => item.lexemeData && resolve(item.rowId)?.spelling === word.word)?.rowId || ""
      }))).sort((a,b) => a.spelling.localeCompare(b.spelling));
    }
    function relationships(id) {
      return rows.filter(row => row.relationshipData && (row.relationshipData.from === id || row.relationshipData.to === id))
        .map(row => { const data = row.relationshipData; const outgoing = data.from === id;
          return { row, data, label: types[data.type]?.[outgoing ? 0 : 1] || data.type,
            target: resolve(outgoing ? data.to : data.from) }; }).filter(edge => edge.target)
        .sort((a,b) => (a.data.order || 0) - (b.data.order || 0) || a.target.spelling.localeCompare(b.target.spelling));
    }
    async function read() {
      const raw = []; let cursor;
      do { const page = await client().scan({ TableName: table, ConsistentRead: true,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }).promise(); raw.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
      } while (cursor);
      return raw;
    }
    function remember(item) { rows = rows.filter(row => key(row) !== key(item)).concat(item); requests.load(rows); }
    function forgetWord(word) {
      rows=rows.flatMap(row=>row.word!==word?[row]:row.conceptData?[{rowId:row.rowId,timestamp:row.timestamp,conceptData:row.conceptData}]:[]);
      requests.load(rows);
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
        rows=rows.filter(row=>row.rowId!==base.rowId);
      } finally {pending--;revision++;}
    }
    async function removeNode(base, field) {
      const previous=await fresh(base,field);
      // Delete links first so a failed cleanup leaves a visible, retryable entry.
      for(const edge of rows.filter(row=>row.relationshipData && [row.relationshipData.from,row.relationshipData.to].includes(base.rowId))) await removeLink(edge);
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
    return {load,read,remember,forgetWord,words,inventory,choices,resolve,relationships,saveInventory,ensureWord,link,removeLink,promote,
      removeInventory:base=>removeNode(base,"morphemeData"),removeWord,renameWord,saveWord,connect,
      requests,version:()=>revision,isBusy:()=>pending>0};
  }
  root.SECRET_RELATIONSHIPS={types,edgeId,validateLink,assemble,preview,create};
  if(typeof module!=="undefined") module.exports=root.SECRET_RELATIONSHIPS;
})(typeof window!=="undefined"?window:globalThis);
