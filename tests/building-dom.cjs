class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.className='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.parentElement=null;this.isConnected=true;}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return (this.text||'')+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  appendChild(node){this.append(node);}
  before(node){if(this.parentElement){const index=this.parentElement.children.indexOf(this);node.parentElement=this.parentElement;this.parentElement.children.splice(index,0,node);}}
  replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
  setAttribute(key,value){this[key]=value;}
  addEventListener(type,callback){(this.listeners[type]||=[]).push(callback);}
  async fire(type,event={}){for(const callback of this.listeners[type]||[])await callback({target:this,preventDefault(){},stopPropagation(){},...event});await new Promise(resolve=>setImmediate(resolve));}
  descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
  matches(selector){return selector.split(',').some(part=>{part=part.trim();return part.startsWith('.')?this.className.split(' ').includes(part.slice(1)):this.tagName===part;});}
  querySelectorAll(selector){return this.descendants().filter(child=>child.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){if(this.document)this.document.activeElement=this;}
  setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
}
function fixture(ids){
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const body=new Element('body');
  const document={activeElement:null,visibilityState:'visible',hasFocus:()=>true,
    getElementById:id=>elements[id],createElement:tag=>{const node=new Element(tag);node.document=document;return node;},
    createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;},
    querySelector:selector=>body.querySelector(selector),addEventListener(){}};
  for(const element of Object.values(elements)){element.document=document;body.append(element);}
  return {elements,body,document};
}
module.exports={Element,fixture};
