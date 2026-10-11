(function(root){
  "use strict";
  const runtime=root.LOVE_LANGUAGE_SHARED.createAwsRuntime(),rules=root.LOVE_LANGUAGE_RULES,api=root.SECRET_RELATIONSHIPS;
  const user=()=>root.SECRET_CURRENT_USER?.id;
  const service=api.create({client:runtime.getHeartsTableClient,table:runtime.awsConfig.heartsTableName,user});
  const el=id=>document.getElementById(id),ui=root.LOVE_LANGUAGE_SHARED.ui;
  let parts=[],choices=[],inventoryBase=null,ready=false,busy=false,revision=0,savedItem=null,operationId=root.crypto.randomUUID(),initial=true;
  let toolbox=[],meaningManual=false,recipeBase=null,dragged=null,recipeComplete=false;
  const workspaceKey=`secret-compound-workspace-v1:${user()}`;
  function persist(){
    try{root.localStorage?.setItem(workspaceKey,JSON.stringify({toolbox,parts,meaningManual,recipeBase,savedItem,operationId,recipeComplete,
      fields:Object.fromEntries(["builtSpelling","builtIpa","builtMeaning","builtRequest","partSearch"].map(id=>[id,el(id).value])),advanced:el("buildingAdvanced").open}));}
    catch{el("buildingStatus").textContent="Browser draft storage is unavailable. You can still build and save words.";}
  }
  function restore(){
    try{const data=JSON.parse(root.localStorage?.getItem(workspaceKey)||"null");if(!data)return;
      const cards=list=>Array.isArray(list)?list.filter(part=>part&&typeof part.spelling==="string").map(part=>({...part,instanceId:part.instanceId||root.crypto.randomUUID()})):[];
      toolbox=cards(data.toolbox);parts=cards(data.parts);meaningManual=Boolean(data.meaningManual);recipeBase=data.recipeBase||null;
      savedItem=data.savedItem||null;recipeComplete=Boolean(data.recipeComplete);operationId=data.operationId||operationId;
      for(const[id,value]of Object.entries(data.fields||{}))if(["builtSpelling","builtIpa","builtMeaning","builtRequest","partSearch"].includes(id)&&typeof value==="string")el(id).value=value;
      el("buildingAdvanced").open=Boolean(data.advanced);el("retryBuiltLinks").hidden=!savedItem||recipeComplete;
    }catch{el("buildingStatus").textContent="Could not restore the browser draft; starting a new workspace.";}
  }
  const local=new Map();
  const panels=root.SECRET_RELATIONSHIP_PANEL.create({service,ready:credentials,onChange:()=>{revision++;renderInventory();}});
  function node(tag,text){const out=document.createElement(tag);if(text!=null)out.textContent=text;return out;}
  function button(text,action){const out=node("button",text);out.type="button";out.addEventListener("click",action);return out;}
  function link(text,href){const out=node("a",text);out.href=href;out.className="page-nav-link";return out;}
  function state(id){if(!local.has(id))local.set(id,{action:"",draft:"",error:"",busy:false});return local.get(id);}
  function status(text){el("buildingSaveStatus").textContent=text;}
  async function credentials(){if(!runtime.isHeartsConfigured||!await runtime.ensureAwsCredentials())throw new Error("Database access is unavailable.");}
  function dirty(){return !savedItem&&Boolean(parts.length||el("builtSpelling").value||el("builtMeaning").value||el("builtRequest").value);}
  function editing(){if(!ready)return busy;return busy||service.isBusy()||panels.isBusy()||!el("inventoryForm").hidden||dirty()||[...local.values()].some(item=>item.action||item.busy)||Boolean(document.activeElement?.matches("input,textarea,select"));}
  function lock(){
    el("buildingForm").querySelectorAll("input,textarea,select,button").forEach(field=>{field.disabled=busy||!ready||Boolean(savedItem);});
    for(const id of ["resetBuilder","retryBuiltLinks"])el(id).disabled=busy||!ready;
    for(const id of ["addSavedPart","addTemporaryPart"])el(id).disabled=busy||!ready||Boolean(savedItem);
    el("saveBuiltWord").disabled=busy||!ready||Boolean(savedItem)||Boolean(collision())||parts.length<2;
    el("useExistingWord").disabled=busy||!ready||Boolean(savedItem)||parts.length<2;
    el("builtRequest").disabled=busy||!ready||Boolean(savedItem);
  }
  function collision(){return service.words().find(item=>item.word===el("builtSpelling").value.trim().replace(/[.-]/g,""));}
  function validate(invalidate=true){
    if(invalidate)el("buildingOverride").checked=false;
    const report=api.preview(el("builtSpelling").value,el("builtIpa").value,rules.loadActiveRuleConfig(),rules);
    el("buildingWarnings").textContent=report.warnings.join(" ");el("buildingOverrideLabel").hidden=!report.warnings.length;
    const existing=collision();el("useExistingWord").hidden=!existing||Boolean(savedItem);
    const identity=existing&&service.choices().find(choice=>choice.kind==="word"&&choice.spelling===existing.word)?.id;
    const recipe=identity&&service.recipeFor(identity);
    el("replaceRecipeLabel").hidden=!recipe;
    if(invalidate)el("replaceRecipe").checked=false;
    el("buildingCollision").textContent=existing?`“${existing.word}” is already ${root.SECRET_DEFINITIONS.classification(existing)}. Use it without replacing its definition, or change the spelling.${recipe?` Saved composition: ${recipe.recipeData.parts.map(part=>part.spelling).join(" + ")}.`:""}`:"";
    lock();return report;
  }
  function derive(){const result=rules.derivePronunciationFromSpelling({spelling:el("builtSpelling").value,config:rules.loadActiveRuleConfig()});el("builtIpa").value=result.pronunciation||"";validate();persist();}
  function gloss(){const value=api.literal(parts);el("literalGloss").textContent=`Literal translation: ${parts.length?parts.map(part=>part.sense||"[No definition]").join(" + "):"Add at least two components"}${parts.length&&!value?" — write a definition or choose a meaning for each component.":""}`;
    if(!meaningManual)el("builtMeaning").value=value;}
  function card(choice){return {...choice,instanceId:root.crypto.randomUUID(),sense:api.senses(choice.meaning)[0]||""};}
  function resolvePart(part){return part.id?service.resolve(part.id):service.choices().find(choice=>choice.kind===part.kind&&(choice.spelling===part.spelling||
    part.word&&choice.word?.records?.some(record=>record.rowId===part.word.rowId&&record.timestamp===part.word.timestamp)));}
  function refreshCard(part){const current=resolvePart(part);if(!current)return;
    part.spelling=current.spelling;part.pronunciation=current.pronunciation;part.meaning=current.meaning||"";if(current.id)part.id=current.id;
    if(!api.senses(part.meaning).includes(part.sense))part.sense=api.senses(part.meaning)[0]||"";
  }
  function assemble(){for(const part of parts){const current=resolvePart(part);if(current)part.spelling=current.spelling;}
    el("builtSpelling").value=api.assemble(parts);gloss();derive();renderParts();persist();}
  function moveCard(instanceId,destination,before=null){
    if(savedItem||busy)return;
    const source=parts.find(part=>part.instanceId===instanceId)||toolbox.find(part=>part.instanceId===instanceId);if(!source||before===instanceId)return;
    if(toolbox.includes(source))refreshCard(source);
    parts=parts.filter(part=>part.instanceId!==instanceId);toolbox=toolbox.filter(part=>part.instanceId!==instanceId);
    const target=destination==="workbench"?parts:toolbox,index=target.findIndex(part=>part.instanceId===before);
    target.splice(index<0?target.length:index,0,source);revision++;assemble();
  }
  function renderParts(){
    if(ui.deferEditorRender(el("buildingParts"),renderParts))return;
    const focus=ui.captureEditor(el("buildingParts")),active=document.activeElement,focusedCard=active?.dataset?.cardId,focusedAction=active?.dataset?.cardAction,
      scroll=[root.scrollX,root.scrollY],counts=service.counts();
    el("buildingParts").replaceChildren();el("buildingToolbox").replaceChildren();
    function render(part,index,workbench){
      const li=node(workbench?"li":"article");li.className="compound-card";li.draggable=!busy&&!savedItem;
      const current=resolvePart(part);
      const spelling=current?.spelling||part.spelling;
      li.append(node("h3",spelling),node("p",part.meaning||"No definition"));
      if(!current&&!part.temporary)li.append(node("p","Component unavailable — replace before saving."));
      if(part.temporary)li.append(node("small","temporary: not linked"));
      const count=counts.get(current?.id||part.id)||{prefix:0,root:0,suffix:0};li.append(node("small",`Prefix ${count.prefix} · Root ${count.root} · Suffix ${count.suffix}`));
      li.addEventListener("dragstart",event=>{dragged=part.instanceId;event.dataTransfer?.setData("text/plain",part.instanceId);if(event.dataTransfer)event.dataTransfer.effectAllowed="move";});
      li.addEventListener("dragend",()=>{dragged=null;});
      li.addEventListener("dragover",event=>event.preventDefault());
      li.addEventListener("drop",event=>{event.preventDefault();event.stopPropagation();moveCard(dragged,workbench?"workbench":"toolbox",part.instanceId);dragged=null;});
      if(workbench){
        const available=api.senses(part.meaning);if(part.sense&&!available.includes(part.sense))available.unshift(part.sense);
        const label=node("label","Meaning used "),select=node("select");select.setAttribute("aria-label",`Meaning used for ${spelling}`);select.dataset.editorKey=part.instanceId;
        if(!available.length)available.push("");for(const sense of available){const option=node("option",sense||"No definition");option.value=sense;select.append(option);}select.value=part.sense||"";
        select.addEventListener("change",()=>{part.sense=select.value;gloss();validate();persist();});label.append(select);li.append(label);
        const move=delta=>{if(savedItem||busy)return;[parts[index],parts[index+delta]]=[parts[index+delta],parts[index]];assemble();};
        const left=button("Move left",()=>move(-1)),right=button("Move right",()=>move(1));left.disabled=index===0;right.disabled=index===parts.length-1;
        li.append(left,right,button("Return to toolbox",()=>moveCard(part.instanceId,"toolbox")));
      }else li.append(button("Add to workbench",()=>moveCard(part.instanceId,"workbench")));
      li.append(button("Dismiss",()=>{if(savedItem||busy)return;toolbox=toolbox.filter(item=>item!==part);parts=parts.filter(item=>item!==part);assemble();}));
      li.querySelectorAll("button,select").forEach(field=>{field.dataset.cardId=part.instanceId;field.dataset.cardAction=field.tagName.toLowerCase()==="select"?"sense":field.textContent;
        if(field.tagName.toLowerCase()==="button")field.setAttribute("aria-label",`${field.textContent}: ${spelling}`);});
      if(!ready||busy||savedItem)li.querySelectorAll("button,select").forEach(field=>field.disabled=true);
      el(workbench?"buildingParts":"buildingToolbox").append(li);
    }
    toolbox.forEach((part,index)=>render(part,index,false));parts.forEach((part,index)=>render(part,index,true));
    if(focusedCard){const fields=[...el("buildingParts").querySelectorAll("button,select"),...el("buildingToolbox").querySelectorAll("button,select")];
      const target=fields.find(field=>field.dataset.cardId===focusedCard&&field.dataset.cardAction===focusedAction&&!field.disabled)||fields.find(field=>field.dataset.cardId===focusedCard&&!field.disabled);
      target?.focus({preventScroll:true});
    }else ui.restoreEditor(el("buildingParts"),focus);
    root.scrollTo({left:scroll[0],top:scroll[1],behavior:"instant"});
  }
  function populateChoices(){
    const selected=choices[Number(el("partChoice").value)],previous=el("partChoice").value,query=el("partSearch").value.normalize("NFC").toLowerCase();choices=service.choices().filter(choice=>choice.kind==="word");
    el("partChoice").replaceChildren();const blank=node("option","Choose a part");blank.value="";el("partChoice").append(blank);
    choices.forEach((choice,index)=>{if(!`${choice.spelling} ${choice.meaning} ${choice.kind} ${choice.category}`.normalize("NFC").toLowerCase().includes(query))return;
      const option=node("option",`${choice.spelling} /${choice.pronunciation}/ — ${choice.meaning||"No definition"} (${choice.kind}, ${choice.category})`);option.value=String(index);el("partChoice").append(option);});
    el("partChoice").value=previous!==""&&selected?String(choices.findIndex(choice=>selected.id?choice.id===selected.id:choice.kind===selected.kind&&choice.spelling===selected.spelling)):"";
    const requestId=el("builtRequest").value;el("builtRequest").replaceChildren();const none=node("option","No requested meaning");none.value="";el("builtRequest").append(none);
    service.requests.list().filter(item=>!service.requests.fulfilled(item)).forEach(item=>{const option=node("option",item.conceptData.text);option.value=item.conceptData.id;el("builtRequest").append(option);});el("builtRequest").value=requestId;
    const saved=el("savedCompound").value;el("savedCompound").replaceChildren();const placeholder=node("option","Choose a saved compound");placeholder.value="";el("savedCompound").append(placeholder);
    for(const recipe of service.recipes()){const word=service.resolve(recipe.recipeData.result);if(!word)continue;const option=node("option",`${word.spelling} — ${recipe.recipeData.literal}`);option.value=recipe.rowId;el("savedCompound").append(option);}el("savedCompound").value=saved;
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
      actions.append(button("Add to toolbox",()=>{if(savedItem||busy)return;toolbox.push(card(value));renderParts();persist();}),button("Edit entry",()=>editInventory(entry)),
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
    const from=await service.ensureWord(savedItem.word);
    for(let index=0;index<parts.length;index++){
      const part=parts[index];
      if(!part.id&&part.word){const source=raw.find(row=>row.rowId===part.word.rowId&&row.timestamp===part.word.timestamp&&row.word);if(source)part.spelling=source.word;}
      const to=part.id||await service.ensureWord(part.spelling);part.id=to;
    }
    await service.saveRecipe({result:from,parts,base:recipeBase,operationId});recipeComplete=true;
    const saved=service.words().find(word=>word.word===savedItem.word),category=root.SECRET_DEFINITIONS.classification(saved);
    el("retryBuiltLinks").hidden=true;status(`Saved “${savedItem.word}” (${category}) and its composition.`);renderParts();persist();
  }
  async function save(useExisting=false){
    if(busy||!ready||savedItem)return;
    if(parts.length<2){status("Choose at least two components.");return;}
    if(parts.some(part=>part.temporary)){status("Save temporary parts in the inventory, then add those saved entries to the workbench.");return;}
    const report=validate(false);if(report.warnings.length&&!el("buildingOverride").checked){status("Review the warnings and explicitly confirm Save despite warnings.");return;}
    if(!el("builtSpelling").value.trim()||!el("builtIpa").value.trim()){status("Spelling and IPA are required.");return;}
    const selected=el("builtRequest").value,request=service.requests.list().find(item=>item.conceptData.id===selected);
    if(!useExisting&&selected&&!request){status("The requested meaning changed. Refresh and choose again.");return;}
    if(!useExisting&&request&&el("builtMeaning").value.trim()){status("Write a definition or select a requested meaning, not both.");return;}
    const target=collision(),identity=target&&service.choices().find(choice=>choice.kind==="word"&&choice.spelling===target.word)?.id;
    const existingRecipe=identity&&service.recipeFor(identity);
    if(existingRecipe&&!el("replaceRecipe").checked){status("Review the saved composition and confirm replacement.");return;}
    if(existingRecipe&&recipeBase&&recipeBase.rowId!==existingRecipe.rowId){status("Reopen the target composition before replacing it.");return;}
    if(existingRecipe&&!recipeBase)recipeBase=existingRecipe;
    if(!existingRecipe)recipeBase=null;
    busy=true;revision++;lock();renderParts();status("Saving…");
    try{await credentials();
      for(const part of parts){
        if(!part.id){const source=resolvePart(part);if(!source)throw new Error("A component is unavailable. Replace it before saving.");part.id=source.id||await service.ensureWord(source.spelling);}
        const current=service.resolve(part.id);if(!current)throw new Error("A component is unavailable. Replace it before saving.");
        if(current.spelling===report.spelling)throw new Error("A compound cannot contain itself.");
      }
      savedItem=await service.saveWord({word:report.spelling,pronunciation:el("builtIpa").value,meaning:el("builtMeaning").value,request,useExisting,operationId});persist();
      try{await saveLinks();}catch(error){el("retryBuiltLinks").hidden=false;status(`Word saved; composition pending. ${error.message}`);persist();}
      populateChoices();renderInventory();
    }catch(error){status(`Could not save: ${error.message} Your draft is retained.`);}
    finally{busy=false;revision++;validate(false);renderParts();}
  }
  el("buildingForm").addEventListener("submit",event=>{event.preventDefault();if(!event.isComposing)void save();});
  el("useExistingWord").addEventListener("click",()=>save(true));
  el("retryBuiltLinks").addEventListener("click",async()=>{if(busy||!savedItem)return;busy=true;lock();try{await credentials();await saveLinks();}catch(error){status(`Word saved; composition pending. ${error.message}`);}finally{busy=false;lock();renderParts();persist();}});
  el("resetBuilder").addEventListener("click",()=>{if(busy)return;toolbox.push(...parts);parts=[];savedItem=null;recipeBase=null;recipeComplete=false;meaningManual=false;operationId=root.crypto.randomUUID();
    for(const id of ["builtSpelling","builtIpa","builtMeaning","builtRequest"])el(id).value="";el("retryBuiltLinks").hidden=true;status("");gloss();renderParts();validate();persist();void sync.request();});
  el("partSearch").addEventListener("input",populateChoices);el("inventorySearch").addEventListener("input",renderInventory);
  function addSelectedCard(){if(!ready||savedItem||busy)return;const choice=choices[Number(el("partChoice").value)];if(el("partChoice").value===""||!choice)return;toolbox.push(card(choice));el("partChoice").value="";renderParts();persist();}
  el("addSavedPart").addEventListener("click",addSelectedCard);el("partChoice").addEventListener("change",addSelectedCard);
  el("addTemporaryPart").addEventListener("click",()=>{if(savedItem||busy)return;const value=el("temporaryPart").value.trim();if(!value)return;
    toolbox.push(card({spelling:value,kind:el("temporaryKind").value,temporary:true}));el("temporaryPart").value="";renderParts();persist();});
  for(const[id,destination]of [["buildingParts","workbench"],["buildingToolbox","toolbox"]]){
    el(id).addEventListener("dragover",event=>event.preventDefault());el(id).addEventListener("drop",event=>{event.preventDefault();moveCard(dragged,destination);dragged=null;});
  }
  el("builtMeaning").addEventListener("input",()=>{meaningManual=true;persist();});
  el("useLiteral").addEventListener("click",()=>{if(savedItem||busy)return;meaningManual=false;gloss();persist();});
  el("builtRequest").addEventListener("change",()=>{if(el("builtRequest").value){meaningManual=true;el("builtMeaning").value="";}persist();});
  el("buildingAdvanced").addEventListener("toggle",persist);
  for(const id of ["builtSpelling","builtIpa","builtMeaning","partSearch"])el(id).addEventListener("input",persist);
  el("openCompound").addEventListener("click",()=>{
    if(busy)return;
    const recipe=service.recipes().find(row=>row.rowId===el("savedCompound").value),target=recipe&&service.resolve(recipe.recipeData.result);if(!target)return;
    if(dirty()){status("Clear or save the current workbench before opening a composition.");return;}
    recipeBase=recipe;savedItem=null;recipeComplete=false;operationId=root.crypto.randomUUID();meaningManual=true;
    parts=recipe.recipeData.parts.map(part=>({...part,kind:service.resolve(part.id)?.kind||"word",instanceId:root.crypto.randomUUID()}));
    el("builtSpelling").value=target.spelling;el("builtIpa").value=target.pronunciation;el("builtMeaning").value=target.meaning;
    el("builtRequest").value="";el("retryBuiltLinks").hidden=true;gloss();validate();renderParts();persist();status("Composition opened. Existing definition and approval will be preserved.");
  });
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
  function apply(raw){service.load(raw);ready=true;
    if(initial){initial=false;const query=new URLSearchParams(root.location.search),id=query.get("entry"),word=query.get("word");
      const choice=id?service.resolve(id):service.choices().find(item=>item.kind==="word"&&item.spelling===word);
      if(choice&&!parts.length){toolbox.push(card(choice));}}
    toolbox.forEach(refreshCard);populateChoices();renderInventory();validate(false);gloss();renderParts();persist();
  }
  restore();gloss();renderParts();
  const sync=root.SECRET_COOPERATIVE_REFRESH.start({read,apply,isBusy:editing,version:()=>`${revision}:${service.version()}`,
    onSuccess:()=>{el("buildingStatus").textContent="Shared word-building data is up to date.";},
    onError:error=>{el("buildingStatus").textContent=`Could not refresh; keeping the last successful data. Refresh / Retry when ready. ${error.message}`;}});
  el("buildingRefresh").addEventListener("click",()=>{if(editing()){el("buildingStatus").textContent="Save or cancel your edits and confirmations before refreshing.";return;}void sync.request();});
  root.addEventListener("secret-rules-imported",()=>{validate();});root.addEventListener("storage",()=>validate());root.addEventListener("beforeunload",()=>sync.stop());
  lock();void sync.request();
})(window);
