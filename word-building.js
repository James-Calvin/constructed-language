(function(root){
  "use strict";
  const runtime=root.LOVE_LANGUAGE_SHARED.createAwsRuntime(),rules=root.LOVE_LANGUAGE_RULES,api=root.SECRET_RELATIONSHIPS;
  const user=()=>root.SECRET_CURRENT_USER?.id;
  const service=api.create({client:runtime.getHeartsTableClient,table:runtime.awsConfig.heartsTableName,user});
  const el=id=>document.getElementById(id),ui=root.LOVE_LANGUAGE_SHARED.ui;
  let parts=[],choices=[],inventoryBase=null,ready=false,busy=false,revision=0,savedItem=null,operationId=root.crypto.randomUUID(),initial=true;
  const local=new Map();
  const panels=root.SECRET_RELATIONSHIP_PANEL.create({service,ready:credentials,onChange:()=>{revision++;renderInventory();}});
  function node(tag,text){const out=document.createElement(tag);if(text!=null)out.textContent=text;return out;}
  function button(text,action){const out=node("button",text);out.type="button";out.addEventListener("click",action);return out;}
  function link(text,href){const out=node("a",text);out.href=href;out.className="page-nav-link";return out;}
  function state(id){if(!local.has(id))local.set(id,{action:"",draft:"",error:"",busy:false});return local.get(id);}
  function status(text){el("buildingSaveStatus").textContent=text;}
  async function credentials(){if(!runtime.isHeartsConfigured||!await runtime.ensureAwsCredentials())throw new Error("Database access is unavailable.");}
  function dirty(){return !savedItem&&Boolean(parts.length||el("builtSpelling").value||el("builtMeaning").value||el("builtRequest").value);}
  function editing(){return busy||service.isBusy()||panels.isBusy()||!el("inventoryForm").hidden||dirty()||[...local.values()].some(item=>item.action||item.busy)||Boolean(document.activeElement?.matches("input,textarea,select"));}
  function lock(){
    el("buildingForm").querySelectorAll("input,textarea,select,button").forEach(field=>{field.disabled=busy||!ready||Boolean(savedItem);});
    for(const id of ["resetBuilder","retryBuiltLinks"])el(id).disabled=busy||!ready;
    for(const id of ["addSavedPart","addTemporaryPart"])el(id).disabled=busy||!ready||Boolean(savedItem);
    el("saveBuiltWord").disabled=busy||!ready||Boolean(savedItem)||Boolean(collision());
  }
  function collision(){return service.words().find(item=>item.word===el("builtSpelling").value.trim().replace(/[.-]/g,""));}
  function validate(invalidate=true){
    if(invalidate)el("buildingOverride").checked=false;
    const report=api.preview(el("builtSpelling").value,el("builtIpa").value,rules.loadActiveRuleConfig(),rules);
    el("buildingWarnings").textContent=report.warnings.join(" ");el("buildingOverrideLabel").hidden=!report.warnings.length;
    const existing=collision();el("useExistingWord").hidden=!existing||Boolean(savedItem);
    el("buildingCollision").textContent=existing?`“${existing.word}” is already ${root.SECRET_DEFINITIONS.classification(existing)}. Use it without replacing its definition, or change the spelling.`:"";
    lock();return report;
  }
  function derive(){const result=rules.derivePronunciationFromSpelling({spelling:el("builtSpelling").value,config:rules.loadActiveRuleConfig()});el("builtIpa").value=result.pronunciation||"";validate();}
  function assemble(){el("builtSpelling").value=api.assemble(parts);derive();renderParts();}
  function renderParts(){
    el("buildingParts").replaceChildren();
    parts.forEach((part,index)=>{const li=node("li",`${part.spelling} /${part.pronunciation||"?"}/ — ${part.meaning||"No meaning"} (${part.kind}${part.temporary?", temporary: not linked":""}) `);
      const move=delta=>{if(savedItem||busy)return;[parts[index],parts[index+delta]]=[parts[index+delta],parts[index]];assemble();};
      const up=button("Move up",()=>move(-1)),down=button("Move down",()=>move(1));up.disabled=index===0||busy||Boolean(savedItem);down.disabled=index===parts.length-1||busy||Boolean(savedItem);
      const remove=button("Remove",()=>{if(savedItem||busy)return;parts.splice(index,1);assemble();});remove.disabled=busy||Boolean(savedItem);
      li.append(up,down,remove);el("buildingParts").append(li);
    });
  }
  function populateChoices(){
    const selected=choices[Number(el("partChoice").value)],previous=el("partChoice").value,query=el("partSearch").value.normalize("NFC").toLowerCase();choices=service.choices();
    el("partChoice").replaceChildren();const blank=node("option","Choose a part");blank.value="";el("partChoice").append(blank);
    choices.forEach((choice,index)=>{if(!`${choice.spelling} ${choice.meaning} ${choice.kind} ${choice.category}`.normalize("NFC").toLowerCase().includes(query))return;
      const option=node("option",`${choice.spelling} /${choice.pronunciation}/ — ${choice.meaning||"No definition"} (${choice.kind}, ${choice.category})`);option.value=String(index);el("partChoice").append(option);});
    el("partChoice").value=previous!==""&&selected?String(choices.findIndex(choice=>selected.id?choice.id===selected.id:choice.kind===selected.kind&&choice.spelling===selected.spelling)):"";
    const requestId=el("builtRequest").value;el("builtRequest").replaceChildren();const none=node("option","No requested meaning");none.value="";el("builtRequest").append(none);
    service.requests.list().filter(item=>!service.requests.fulfilled(item)).forEach(item=>{const option=node("option",item.conceptData.text);option.value=item.conceptData.id;el("builtRequest").append(option);});el("builtRequest").value=requestId;
  }
  function editInventory(base=null){inventoryBase=base;el("inventoryForm").hidden=false;
    for(const[name,key]of [["Kind","kind"],["Spelling","spelling"],["Ipa","pronunciation"],["Meaning","meaning"],["Notes","notes"]])el(`inventory${name}`).value=base?.morphemeData[key]||(key==="kind"?"root":"");
    el("inventoryError").textContent="";el("inventorySpelling").focus();}
  function renderInventory(){
    const list=el("inventoryList");if(ui.deferEditorRender(list,renderInventory))return;
    const focus=ui.captureEditor(list),scroll=[root.scrollX,root.scrollY];list.replaceChildren();
    const query=el("inventorySearch").value.normalize("NFC").toLowerCase();
    for(const entry of service.inventory()){
      const value=service.resolve(entry.rowId),data=entry.morphemeData,s=state(entry.rowId);
      if(!`${value.spelling} ${value.meaning} ${value.kind} ${data.notes}`.normalize("NFC").toLowerCase().includes(query))continue;
      const li=node("li");li.className="inventory-card";
      li.append(node("h3",`${value.spelling} /${value.pronunciation}/ (${value.kind})`),node("p",value.meaning||"No meaning yet"));
      if(data.notes)li.append(node("p",data.notes));
      li.append(node("small",`Created by ${data.author} · ${new Date(data.createdAt).toLocaleDateString()}; edited by ${data.editedBy} · ${new Date(data.editedAt).toLocaleDateString()}`));
      if(value.category!=="defined"&&value.kind==="root")li.append(node("p","Not a defined dictionary word"));
      const existing=service.words().find(word=>word.word===value.spelling);
      if(value.counterpart)li.append(link(`View dictionary counterpart (${value.category})`,`dictionary.html?word=${encodeURIComponent(value.spelling)}`));
      async function mutate(action){if(s.busy)return;s.busy=true;s.error="";revision++;renderInventory();
        try{await credentials();await action();s.action="";populateChoices();validate();}
        catch(error){s.error=error.code==="ConditionalCheckFailedException"?"This entry changed. Refresh and reopen it; your draft is retained.":error.message;}
        finally{s.busy=false;revision++;renderInventory();}}
      const actions=node("div");actions.className="relationship-actions";
      actions.append(button("Add to assembly",()=>{if(savedItem||busy)return;parts.push({...value});assemble();}),button("Edit entry",()=>editInventory(entry)),
        button("Delete entry",()=>{s.action="delete";renderInventory();}));
      for(const position of ["start","end"])actions.append(link(`Generate ${position==="start"?"starting":"ending"} with this root`,`index.html?rootId=${encodeURIComponent(entry.rowId)}&rootPosition=${position}`));
      if(!value.counterpart||!data.counterpartId)actions.append(button(existing?"Connect existing word":"Create candidate root",()=>{
        if(existing){void mutate(()=>service.connect(entry,existing.word));return;}
        if(!data.meaning){s.action="promote";renderInventory();return;}
        void mutate(()=>service.promote(entry));
      }));li.append(actions);
      if(s.action==="delete")li.append(node("p","Delete this inventory entry and its links? Connected dictionary words will be kept."),
        button("Confirm delete",()=>mutate(()=>service.removeInventory(entry))),button("Cancel",()=>{s.action="";s.error="";renderInventory();}));
      if(s.action==="promote"){
        const form=node("form"),input=node("textarea");input.value=s.draft;input.maxLength=2000;input.required=true;input.setAttribute("aria-label","Definition for candidate root");input.addEventListener("input",()=>{s.draft=input.value;});
        const submit=button("Create candidate",()=>{});submit.type="submit";form.append(input,submit,button("Cancel",()=>{s.action="";renderInventory();}));
        form.addEventListener("submit",event=>{event.preventDefault();void mutate(async()=>{if(!s.draft.trim())throw new Error("Enter a definition.");
          await service.promote(entry,s.draft);});});li.append(form);
      }
      const message=node("p",s.busy?"Saving…":s.error);message.setAttribute("role","status");li.append(message);
      li.append(panels.render(value.spelling,entry.rowId));
      if(s.busy)li.querySelectorAll("button,input,textarea").forEach(field=>field.disabled=true);list.append(li);
    }
    if(!list.children.length)list.append(node("li","No matching inventory entries. Add a root or affix to get started."));
    ui.restoreEditor(list,focus);root.scrollTo({left:scroll[0],top:scroll[1],behavior:"instant"});
  }
  async function saveLinks(){
    const raw=await service.read();service.load(raw);
    const current=raw.find(row=>row.rowId===savedItem.rowId&&row.timestamp===savedItem.timestamp&&row.word);
    if(!current)throw new Error("The saved word no longer exists. Refresh the dictionary before continuing.");
    savedItem={...savedItem,word:current.word};el("builtSpelling").value=current.word;
    const from=await service.ensureWord(savedItem.word),roots=parts.filter(part=>!["prefix","suffix"].includes(part.kind));
    for(let index=0;index<parts.length;index++){
      const part=parts[index];if(part.temporary)continue;
      if(!part.id&&part.word){const source=raw.find(row=>row.rowId===part.word.rowId&&row.timestamp===part.word.timestamp&&row.word);if(source)part.spelling=source.word;}
      const to=part.id||await service.ensureWord(part.spelling);part.id=to;if(from===to)continue;
      const type=part.kind==="prefix"?"prefix":part.kind==="suffix"?"suffix":roots.length>1?"compound":"derived";
      await service.link(from,to,type,"",index);
    }
    const saved=service.words().find(word=>word.word===savedItem.word),category=root.SECRET_DEFINITIONS.classification(saved);
    el("retryBuiltLinks").hidden=true;status(`Saved “${savedItem.word}” (${category}) and its relationships.`);
  }
  async function save(useExisting=false){
    if(busy||!ready||savedItem)return;
    const report=validate(false);if(report.warnings.length&&!el("buildingOverride").checked){status("Review the warnings and explicitly confirm Save despite warnings.");return;}
    if(!el("builtSpelling").value.trim()||!el("builtIpa").value.trim()){status("Spelling and IPA are required.");return;}
    const selected=el("builtRequest").value,request=service.requests.list().find(item=>item.conceptData.id===selected);
    if(!useExisting&&selected&&!request){status("The requested meaning changed. Refresh and choose again.");return;}
    if(!useExisting&&request&&el("builtMeaning").value.trim()){status("Write a definition or select a requested meaning, not both.");return;}
    busy=true;revision++;lock();renderParts();status("Saving…");
    try{await credentials();savedItem=await service.saveWord({word:report.spelling,pronunciation:el("builtIpa").value,meaning:el("builtMeaning").value,request,useExisting,operationId});
      try{await saveLinks();}catch(error){el("retryBuiltLinks").hidden=false;status(`Word saved; relationships pending. ${error.message}`);}
      populateChoices();renderInventory();
    }catch(error){status(`Could not save: ${error.message} Your draft is retained.`);}
    finally{busy=false;revision++;validate(false);renderParts();}
  }
  el("buildingForm").addEventListener("submit",event=>{event.preventDefault();if(!event.isComposing)void save();});
  el("useExistingWord").addEventListener("click",()=>save(true));
  el("retryBuiltLinks").addEventListener("click",async()=>{if(busy||!savedItem)return;busy=true;lock();try{await credentials();await saveLinks();}catch(error){status(`Word saved; relationships pending. ${error.message}`);}finally{busy=false;lock();}});
  el("resetBuilder").addEventListener("click",()=>{if(busy)return;parts=[];savedItem=null;operationId=root.crypto.randomUUID();
    for(const id of ["builtSpelling","builtIpa","builtMeaning","builtRequest"])el(id).value="";el("retryBuiltLinks").hidden=true;status("");renderParts();validate();void sync.request();});
  el("partSearch").addEventListener("input",populateChoices);el("inventorySearch").addEventListener("input",renderInventory);
  el("addSavedPart").addEventListener("click",()=>{if(savedItem||busy)return;const choice=choices[Number(el("partChoice").value)];if(el("partChoice").value===""||!choice)return;parts.push({...choice});assemble();});
  el("addTemporaryPart").addEventListener("click",()=>{if(savedItem||busy)return;const value=el("temporaryPart").value.trim();if(!value)return;
    parts.push({spelling:value,kind:el("temporaryKind").value,temporary:true});el("temporaryPart").value="";assemble();});
  el("builtSpelling").addEventListener("input",event=>{if(!event.isComposing)derive();});el("builtSpelling").addEventListener("compositionend",derive);
  el("builtIpa").addEventListener("input",()=>validate());el("newInventory").addEventListener("click",()=>editInventory());
  el("cancelInventory").addEventListener("click",()=>{el("inventoryForm").hidden=true;inventoryBase=null;el("newInventory").focus();void sync.request();});
  el("inventorySpelling").addEventListener("input",event=>{if(event.isComposing)return;el("inventoryIpa").value=rules.derivePronunciationFromSpelling({spelling:el("inventorySpelling").value,config:rules.loadActiveRuleConfig()}).pronunciation||"";});
  el("inventoryForm").addEventListener("submit",async event=>{event.preventDefault();if(busy||event.isComposing)return;busy=true;revision++;
    const fields=[...el("inventoryForm").querySelectorAll("input,textarea,select,button")];fields.forEach(field=>field.disabled=true);
    try{await credentials();await service.saveInventory({kind:el("inventoryKind").value,spelling:el("inventorySpelling").value,pronunciation:el("inventoryIpa").value,meaning:el("inventoryMeaning").value,notes:el("inventoryNotes").value},inventoryBase);
      el("inventoryForm").hidden=true;inventoryBase=null;el("newInventory").focus();populateChoices();renderInventory();}
    catch(error){el("inventoryError").textContent=`${error.message} Your draft is retained.`;}
    finally{busy=false;revision++;fields.forEach(field=>field.disabled=false);}});
  async function read(){await credentials();return service.read();}
  function apply(raw){service.load(raw);ready=true;populateChoices();renderInventory();validate(false);
    if(initial){initial=false;const query=new URLSearchParams(root.location.search),id=query.get("entry"),word=query.get("word");
      const choice=id?service.resolve(id):service.choices().find(item=>item.kind==="word"&&item.spelling===word);
      if(choice){parts.push({...choice});assemble();}}
  }
  const sync=root.SECRET_COOPERATIVE_REFRESH.start({read,apply,isBusy:editing,version:()=>`${revision}:${service.version()}`,
    onSuccess:()=>{el("buildingStatus").textContent="Shared word-building data is up to date.";},
    onError:error=>{el("buildingStatus").textContent=`Could not refresh; keeping the last successful data. Refresh / Retry when ready. ${error.message}`;}});
  el("buildingRefresh").addEventListener("click",()=>{if(editing()){el("buildingStatus").textContent="Save or cancel your edits and confirmations before refreshing.";return;}void sync.request();});
  root.addEventListener("secret-rules-imported",()=>{validate();});root.addEventListener("storage",()=>validate());root.addEventListener("beforeunload",()=>sync.stop());
  lock();void sync.request();
})(window);
