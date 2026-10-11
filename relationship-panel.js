(function(root){
  "use strict";
  function node(tag,text){const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;}
  function button(text,action){const el=node("button",text);el.type="button";el.className="dictionary-word-action";el.addEventListener("click",action);return el;}
  function create({service,ready=async()=>{},onChange=()=>{}}){
    const states=new Map();
    function state(word){if(!states.has(word))states.set(word,{open:false,editing:false,target:"",query:"",type:"derived",explanation:"",error:"",busy:false,edge:null,deleting:null});return states.get(word);}
    function render(word,identity=null){
      const local=state(identity||word),details=node("details");details.className="word-relationships";details.open=local.open;
      details.append(node("summary","Roots and related words"));
      details.addEventListener("toggle",()=>{local.open=details.open;});
      for(const type of ["click","input","keydown"])details.addEventListener(type,event=>event.stopPropagation());
      const self=identity?service.resolve(identity):service.choices().find(item=>item.kind==="word"&&item.spelling===word);
      const list=node("ul");
      for(const edge of self?.id?service.relationships(self.id):[]){
        const li=node("li"),link=node("a",`${edge.target.spelling} /${edge.target.pronunciation}/ — ${edge.target.meaning || "No definition"}`);
        link.href=edge.target.kind==="word"?`dictionary.html?word=${encodeURIComponent(edge.target.spelling)}`:`word-building.html?entry=${encodeURIComponent(edge.target.id)}`;
        li.append(node("span",`${edge.label}: `),link);
        if(edge.data.explanation)li.append(node("p",edge.data.explanation));
        li.append(node("small",`Edited by ${edge.data.editedBy || edge.data.author} · ${new Date(edge.data.editedAt || edge.data.createdAt).toLocaleDateString()}`));
        li.append(button("Edit relationship",()=>{local.editing=true;local.edge=edge.row;local.type=edge.data.type;local.explanation=edge.data.explanation;onChange();}),
          button("Remove link",()=>{local.deleting=edge.row;onChange();}));
        list.append(li);
      }
      if(!list.children.length)list.append(node("li","No relationships yet."));
      details.append(list);
      const shortcuts=node("div");shortcuts.className="relationship-actions";
      const query=identity?`rootId=${encodeURIComponent(identity)}`:`rootWord=${encodeURIComponent(word)}`;
      for(const [label,url]of [["Build with this word",identity?`word-building.html?entry=${encodeURIComponent(identity)}`:`word-building.html?word=${encodeURIComponent(word)}`],
        ["Generate starting with this root",`index.html?${query}&rootPosition=start`],
        ["Generate ending with this root",`index.html?${query}&rootPosition=end`]]){
        const link=node("a",label);link.className="page-nav-link";link.href=url;shortcuts.append(link);
      }
      details.append(shortcuts);
      async function run(action){if(local.busy)return;local.busy=true;local.error="";onChange();
        try{await ready();await action();local.editing=false;local.edge=null;local.deleting=null;local.explanation="";}
        catch(error){local.error=error.code==="ConditionalCheckFailedException"?"This relationship changed. Refresh and reopen it; your draft is retained.":error.message;}
        finally{local.busy=false;onChange();}}
      if(local.deleting){
        const warning=node("div");warning.append(node("p","Remove this relationship? Neither word will be deleted."),
          button("Confirm remove",()=>run(()=>service.removeLink(local.deleting))),button("Cancel",()=>{local.deleting=null;local.error="";onChange();}));details.append(warning);
      }
      if(local.editing){
        const form=node("form"),query=node("input"),select=node("select"),type=node("select"),explanation=node("textarea");
        query.value=local.query;query.placeholder="Search words and inventory";query.setAttribute("aria-label","Search relationship targets");
        select.setAttribute("aria-label","Relationship target");type.setAttribute("aria-label","Relationship type");
        const choices=service.choices().filter(item=>identity?item.id!==identity:item.spelling!==word||item.kind!=="word");
        function populate(){select.replaceChildren();const blank=node("option","Choose a word or root");blank.value="";select.append(blank);
          choices.forEach((choice,index)=>{if(!`${choice.spelling} ${choice.meaning} ${choice.kind}`.normalize("NFC").toLowerCase().includes(local.query.normalize("NFC").toLowerCase()))return;
            const option=node("option",`${choice.spelling} /${choice.pronunciation}/ — ${choice.meaning||"No definition"} (${choice.kind}, ${choice.category})`);option.value=String(index);select.append(option);});select.value=local.target;}
        populate();query.addEventListener("input",()=>{local.query=query.value;populate();});select.addEventListener("change",()=>{local.target=select.value;});
        for(const[id,labels]of Object.entries(root.SECRET_RELATIONSHIPS.types)){const option=node("option",labels[0]);option.value=id;type.append(option);}type.value=local.type;
        type.addEventListener("change",()=>{local.type=type.value;});explanation.value=local.explanation;explanation.maxLength=2000;explanation.setAttribute("aria-label","Relationship explanation");
        explanation.addEventListener("input",()=>{local.explanation=explanation.value;});
        if(!local.edge)form.append(query,select);form.append(type,explanation);
        const save=button("Save relationship",()=>{});save.type="submit";form.append(save,button("Cancel",()=>{local.editing=false;local.edge=null;local.error="";onChange();}));
        form.addEventListener("submit",event=>{event.preventDefault();if(event.isComposing)return;void run(async()=>{
          if(local.edge){const data=local.edge.relationshipData;await service.link(data.from,data.to,local.type,local.explanation,data.order,local.edge);}
          else{const target=choices[Number(local.target)];if(local.target===""||!target)throw new Error("Choose a relationship target.");
            const from=identity||await service.ensureWord(word),to=target.id||await service.ensureWord(target.spelling);await service.link(from,to,local.type,local.explanation,0,null,false);}
        });});details.append(form);
      }else details.append(button("Add relationship",()=>{local.editing=true;local.edge=null;local.target="";local.explanation="";onChange();}));
      const status=node("p",local.busy?"Saving…":local.error);status.setAttribute("role","status");details.append(status);
      if(local.busy)details.querySelectorAll("button,input,select,textarea").forEach(el=>el.disabled=true);
      return details;
    }
    return{render,isBusy:()=>[...states.values()].some(local=>local.busy||local.editing||local.deleting)};
  }
  root.SECRET_RELATIONSHIP_PANEL={create};
})(window);
