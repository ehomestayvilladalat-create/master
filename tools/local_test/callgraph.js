// Phân tích đồ thị gọi hàm cho dự án Apps Script (tất cả file chung 1 global scope).
const fs=require('fs'),path=require('path'),acorn=require('acorn'),walk=require('acorn-walk');
const dir=process.argv[2];
const jsFiles=fs.readdirSync(dir).filter(f=>/\.(js|gs)$/.test(f)).sort();
const htmlFiles=fs.readdirSync(dir).filter(f=>/\.html$/.test(f));
const defs={}; // name -> {file, start, end, refs:Set}
const topVars={};
const asts={};
for(const f of jsFiles){
  const src=fs.readFileSync(path.join(dir,f),'utf8');
  const ast=acorn.parse(src,{ecmaVersion:2020,sourceType:'script',locations:true,allowHashBang:true});
  asts[f]={ast,src};
  for(const node of ast.body){
    if(node.type==='FunctionDeclaration'&&node.id){defs[node.id.name]={file:f,line:node.loc.start.line,node,refs:new Set(),bytes:node.end-node.start};}
    if(node.type==='VariableDeclaration'){for(const d of node.declarations){if(d.id&&d.id.name)topVars[d.id.name]={file:f,line:node.loc.start.line,node:d};}}
  }
}
const names=new Set(Object.keys(defs));
// Tham chiếu theo identifier trong thân hàm + chuỗi ký tự trùng tên hàm (typeof x==="function", trigger, menu...)
function collect(node,into){
  walk.full(node,(n)=>{
    if(n.type==='Identifier'&&names.has(n.name))into.add(n.name);
    if(n.type==='Literal'&&typeof n.value==='string'){
      // chuỗi đúng bằng tên hàm, hoặc chứa tên hàm dạng "abc(" hoặc "abc"
      const m=n.value.match(/[A-Za-z_$][A-Za-z0-9_$]*/g)||[];
      for(const t of m) if(names.has(t)) into.add(t);
    }
    if(n.type==='TemplateElement'){const m=(n.value.raw||'').match(/[A-Za-z_$][A-Za-z0-9_$]*/g)||[];for(const t of m) if(names.has(t)) into.add(t);}
  });
}
const edges={};
for(const [name,d] of Object.entries(defs)){const s=new Set();collect(d.node.body,s);collect(d.node,s);s.delete(name);edges[name]=s;}
// Top-level code (biến toàn cục, lời gọi ở top-level) là gốc
const roots=new Set();
for(const f of jsFiles){
  for(const node of asts[f].ast.body){
    if(node.type==='FunctionDeclaration')continue;
    const s=new Set();collect(node,s);s.forEach(x=>roots.add(x));
  }
}
// HTML: google.script.run.X và mọi token trùng tên hàm
const htmlRefs=new Set();
for(const f of htmlFiles){const src=fs.readFileSync(path.join(dir,f),'utf8');const m=src.match(/[A-Za-z_$][A-Za-z0-9_$]*/g)||[];for(const t of m) if(names.has(t)) htmlRefs.add(t);}
htmlRefs.forEach(x=>roots.add(x));
['doGet','doPost','onOpen','onEdit','onInstall','onChange','onFormSubmit'].forEach(x=>{if(names.has(x))roots.add(x);});
// Hàm public (không kết thúc bằng _) có thể chạy tay trong editor / trigger => coi là gốc
const publicFns=[...names].filter(n=>!n.endsWith('_'));
const mode=process.argv[3]||'public-roots';
if(mode==='public-roots') publicFns.forEach(x=>roots.add(x));
// reachability
const reach=new Set();const stack=[...roots];
while(stack.length){const x=stack.pop();if(reach.has(x)||!names.has(x))continue;reach.add(x);(edges[x]||[]).forEach(y=>stack.push(y));}
// incoming refs count (từ hàm khác hoặc top-level/html)
const incoming={};for(const n of names)incoming[n]=0;
for(const [a,s] of Object.entries(edges)) s.forEach(b=>incoming[b]++);
roots.forEach(r=>{if(names.has(r))incoming[r]=incoming[r]||0;});
const out={total:names.size,reachable:reach.size,deadPrivate:[],unreferencedPublic:[]};
for(const n of names){
  const d=defs[n];
  if(!reach.has(n)) out.deadPrivate.push({name:n,file:d.file,line:d.line,bytes:d.bytes});
}
// public không ai gọi (ngoài html/top-level/hàm khác)
for(const n of publicFns){
  const referenced=incoming[n]>0||htmlRefs.has(n);
  let topRef=false;
  if(!referenced){ out.unreferencedPublic.push({name:n,file:defs[n].file,line:defs[n].line,bytes:defs[n].bytes}); }
}
fs.writeFileSync(path.join(__dirname,'callgraph.json'),JSON.stringify(out,null,1));
console.log(JSON.stringify({total:out.total,reachable:out.reachable,deadPrivate:out.deadPrivate.length,deadPrivateBytes:out.deadPrivate.reduce((a,b)=>a+b.bytes,0),unreferencedPublic:out.unreferencedPublic.length,unreferencedPublicBytes:out.unreferencedPublic.reduce((a,b)=>a+b.bytes,0)}));
