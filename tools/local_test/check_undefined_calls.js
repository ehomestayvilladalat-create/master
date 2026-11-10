const fs=require('fs'),path=require('path'),acorn=require('acorn'),walk=require('acorn-walk');
const dir=process.argv[2];
const files=fs.readdirSync(dir).filter(f=>/\.(js|gs)$/.test(f));
const defined=new Set();
const asts=files.map(f=>[f,acorn.parse(fs.readFileSync(path.join(dir,f),'utf8'),{ecmaVersion:2020,locations:true})]);
for(const [f,ast] of asts) for(const n of ast.body){ if(n.type==='FunctionDeclaration')defined.add(n.id.name); if(n.type==='VariableDeclaration')n.declarations.forEach(d=>d.id.name&&defined.add(d.id.name)); }
// tên khai báo ở bất kỳ đâu (hàm lồng, biến, tham số) để loại trừ
const anyDeclared=new Set();
for(const [f,ast] of asts) walk.full(ast,n=>{ if((n.type==='FunctionDeclaration'||n.type==='FunctionExpression')&&n.id)anyDeclared.add(n.id.name); if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')anyDeclared.add(n.id.name); if(n.params)n.params.forEach(p=>p.type==='Identifier'&&anyDeclared.add(p.name)); if(n.type==='CatchClause'&&n.param&&n.param.name)anyDeclared.add(n.param.name);});
const builtins=new Set(['String','Number','Boolean','Date','Array','Object','JSON','Math','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','escape','unescape','RegExp','Error','TypeError','Symbol','Map','Set','Function']);
const res={};
for(const [f,ast] of asts) walk.full(ast,n=>{ if(n.type==='CallExpression'&&n.callee.type==='Identifier'){const k=n.callee.name; if(!defined.has(k)&&!anyDeclared.has(k)&&!builtins.has(k)) (res[k]=res[k]||[]).push(f+':'+n.loc.start.line);} });
Object.entries(res).forEach(([k,v])=>console.log(k, v.slice(0,4).join(', ')));
console.log('total', Object.keys(res).length);
