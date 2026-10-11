(function(root){
  "use strict";
  function create({client,table,user,inputs,revalidate,rerender,refresh}){
    const query=new URLSearchParams(root.location.search),rootId=query.get("rootId"),rootWord=query.get("rootWord");
    if(!rootId&&!rootWord)return null;
    const service=root.SECRET_RELATIONSHIPS.create({client,table,user});
    let active=true,loaded=false,source=null,initialized=false,busy=0;
    const position=query.get("rootPosition")==="end"?"end":"start";
    const banner=document.createElement("section");banner.className="root-context-banner";
    const message=document.createElement("p"),clear=document.createElement("button"),retry=document.createElement("button");
    clear.type=retry.type="button";clear.textContent="Clear root context";retry.textContent="Retry root load";
    message.setAttribute("role","status");banner.append(message,retry,clear);
    document.querySelector(".prefix-options").before(banner);
    function update(){banner.hidden=!active;retry.hidden=loaded;
      message.textContent=source?`Generating with root ${source.spelling} /${source.pronunciation}/ — ${source.meaning||"No definition"}. Links are saved only when you save the word.`:"Root context is unavailable. Retry or clear it to generate normally.";
      revalidate();}
    clear.addEventListener("click",()=>{active=false;inputs[position].value="";banner.hidden=true;revalidate();rerender();});
    retry.addEventListener("click",refresh);
    function accept(raw){
      service.load(raw);if(!active)return;
      const prior=source;
      source=rootId?service.resolve(rootId):prior?.id?service.resolve(prior.id):service.choices().find(item=>item.kind==="word"&&item.spelling===rootWord);
      if(!source&&prior?.word){const renamed=raw.find(item=>item.rowId===prior.word.rowId&&item.timestamp===prior.word.timestamp&&item.word);
        if(renamed)source=service.choices().find(item=>item.kind==="word"&&item.spelling===renamed.word);}
      loaded=Boolean(source);
      if(source&&!initialized){initialized=true;inputs.start.value=position==="start"?source.spelling:"";inputs.end.value=position==="end"?source.spelling:"";document.querySelector(".prefix-options").open=true;}
      else if(source&&prior&&source.spelling!==prior.spelling&&inputs[position].value===prior.spelling&&document.activeElement!==inputs[position])inputs[position].value=source.spelling;
      update();
    }
    async function saved(state,item){
      if(!active||!source||state.linkRoot===false||!state.hearted)return;
      busy++;
      try{
        const raw=await service.read();service.load(raw);
        const current=raw.find(row=>row.rowId===item.rowId&&row.timestamp===item.timestamp&&row.word);
        if(!current)throw new Error("The saved word no longer exists. Refresh before retrying.");
        if(!source.id&&source.word){const currentRoot=raw.find(row=>row.rowId===source.word.rowId&&row.timestamp===source.word.timestamp&&row.word);if(currentRoot)source.spelling=currentRoot.word;}
        const from=await service.ensureWord(current.word),to=source.id||await service.ensureWord(source.spelling);
        source.id=to;
        if(from!==to)await service.link(from,to,"derived");
        state.relationshipError="";state.pendingRootLink=null;
      }catch(error){state.relationshipError=`Word saved; relationships pending. ${error.message}`;state.pendingRootLink=item;}
      finally{busy--;rerender();}
    }
    function render(row,state,selected){
      if(!active||!selected)return;
      const container=row.querySelector(".row-meaning"),label=document.createElement("label"),check=document.createElement("input");
      label.className="root-link-choice";check.type="checkbox";check.checked=state.linkRoot!==false;check.disabled=state.saveStatus!=="idle"||Boolean(busy);
      label.append(check,document.createTextNode("Link as derived from this root"));
      check.addEventListener("change",()=>{state.linkRoot=check.checked;if(!check.checked){state.pendingRootLink=null;state.relationshipError="";rerender();}});label.addEventListener("click",event=>event.stopPropagation());container.append(label);
      if(state.relationshipError){const status=document.createElement("p");status.textContent=state.relationshipError;status.setAttribute("role","status");container.append(status);
        const retry=document.createElement("button");retry.type="button";retry.textContent="Retry missing relationship";retry.disabled=Boolean(busy);
        retry.addEventListener("click",event=>{event.stopPropagation();if(state.pendingRootLink)void saved(state,state.pendingRootLink);});container.append(retry);}
    }
    update();return{accept,saved,render,isActive:()=>active,ready:()=>!active||loaded,isBusy:()=>Boolean(busy),error(){loaded=Boolean(source);update();}};
  }
  root.SECRET_ROOT_GENERATION={create};
})(window);
