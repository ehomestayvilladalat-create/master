// Mô phỏng luồng B1+B2 qua nhiều lần build, dùng code thật.
const fs=require('fs'),vm=require('vm'),path=require('path');
const H=fs.readFileSync(__dirname+'/harness.js','utf8');
const dir=process.argv[2];
// tái dùng makeContext từ harness bằng cách eval phần định nghĩa
const src=H.split('// enumerate test function names')[0].replace("const dir = process.argv[2];","const dir = "+JSON.stringify(dir)+";").replace(/const filter[^\n]*\n/,'const filter=null;\n').replace(/const outIdx[^\n]*\n/,'').replace(/const outFile[^\n]*\n/,'');
eval(src);
const {ctx}=makeContext();
const run=(code)=>vm.runInContext(code,ctx);
function assert(c,m){if(!c){console.log('FAIL:',m);process.exitCode=1;}else console.log('ok  :',m);}
run(`
var prevRows=[["VL-A","","Villa A","Đà Lạt","mp","L"],["VL-B","","Villa B","Đà Lạt","mp","L"],["VL-C","","Villa C","Đà Lạt","mp","L"]];
var nowVillas=[{name:"Villa A",sourceColumn:3},{name:"Villa B",sourceColumn:4}];
function build(prev,villas){beGhostBeginRunV1_();var d=beAssessSourceReconcileV416_({sourceId:"62",source:"mp",link:"L",previousRows:prev,villas:villas});var f=beGhostFlushV1_();return {d:d,f:f};}
var r1=build(prevRows,nowVillas);
var r1b=build(prevRows,nowVillas); // build ngay sau đó (10 phút) => chưa đủ 6 giờ
// giả lập 7 giờ trôi qua: lùi mốc thời gian đã lưu
var stx=JSON.parse(PropertiesService.getScriptProperties().getProperty("BE_GHOST_STATE_V2"));
Object.keys(stx).forEach(function(k){if(stx[k].c){stx[k].c-=7*3600000;stx[k].a-=7*3600000;}});
PropertiesService.getScriptProperties().setProperty("BE_GHOST_STATE_V2",JSON.stringify(stx));
var r2=build(prevRows,nowVillas);
PropertiesService.getScriptProperties().setProperty("BE_GHOST_MIN_GAP_HOURS","0"); // phần sau test logic khác, bỏ khoảng cách
var props=PropertiesService.getScriptProperties().getProperties();
`);
const r1=run('r1'),r2=run('r2');
assert(r1.d.allow===false,'build 1: căn C biến mất -> chưa ẩn (chờ lần đọc 2)');
assert(run('r1b.d.allow')===false,'build lại ngay 10 phút sau -> vẫn chưa ẩn (chưa đủ 6 giờ)');
assert(r2.d.allow===true&&r2.d.mode==='CONFIRMED_REMOVAL','build 2: đọc giống -> cho phép ẩn ('+r2.d.reason+')');
assert(!run('PropertiesService.getScriptProperties().getProperty("BE_GHOST_STATE_V2")'),'sau khi ẩn: xóa trạng thái đếm (không còn property)');
assert(Object.keys(run('PropertiesService.getScriptProperties().getProperties()')).filter(k=>k.startsWith('BE_GHOST_')).length<=2,'chỉ dùng tối đa 1 property trạng thái');
// Danh sách dao động: build 3 khác danh sách -> đếm lại
run(`var r3=build(prevRows,[{name:"Villa A",sourceColumn:3}]); var r4=build(prevRows,[{name:"Villa A",sourceColumn:3},{name:"Villa B",sourceColumn:4}]);`);
assert(run('r3.d.allow')===false&&run('r3.d.reason')!=='GHOST_GUARD_STABLE_READS_V1','giảm 3->1 (67%) -> chặn, không ẩn');
assert(run('r4.d.allow')===false,'danh sách đổi so với lần trước -> đếm lại, chưa ẩn');
// >30%: 3 -> 1 hai lần liên tiếp vẫn chặn; admin duyệt -> cho
run(`var r5=build(prevRows,[{name:"Villa A",sourceColumn:3}]); var r6=build(prevRows,[{name:"Villa A",sourceColumn:3}]);`);
assert(run('r6.d.allow')===false,'giảm >30% đọc ổn định 2 lần vẫn chặn khi chưa duyệt');
run(`ghostApproveSourceV1("62"); var r7=build(prevRows,[{name:"Villa A",sourceColumn:3}]);`);
assert(run('r7.d.allow')===true,'admin duyệt + đọc ổn định -> cho ẩn');
assert(!(JSON.parse(run('PropertiesService.getScriptProperties().getProperty("BE_GHOST_STATE_V2")')||'{}').ID_62||{}).ap,'duyệt chỉ dùng 1 lần');
// Không có căn biến mất -> không đụng GhostGuard
run(`var r8=build(prevRows,[{name:"Villa A",sourceColumn:3},{name:"Villa B",sourceColumn:4},{name:"Villa C",sourceColumn:5}]);`);
assert(run('r8.d.mode')==='NO_REMOVAL','không có căn biến mất -> NO_REMOVAL như cũ');
// Ngân sách: 41 nguồn mỗi nguồn mất 1 căn trong cùng build
run(`
var okCount=0;
for(var pass=0;pass<2;pass++){beGhostBeginRunV1_();okCount=0;
 for(var s=0;s<45;s++){var d=beAssessSourceReconcileV416_({sourceId:"S"+s,source:"src"+s,link:"L"+s,previousRows:[["X1","","n1","","src"+s,"L"+s],["X2","","n2","","src"+s,"L"+s],["X3","","n3","","src"+s,"L"+s],["X4","","n4","","src"+s,"L"+s]],villas:[{name:"n1",sourceColumn:3},{name:"n2",sourceColumn:4},{name:"n3",sourceColumn:5}]});if(d.allow)okCount++;}
 beGhostFlushV1_();}
`);
assert(run('okCount')===40,'giới hạn 40 căn ẩn mỗi lần build (thực tế '+run('okCount')+')');
assert(Object.keys(run('PropertiesService.getScriptProperties().getProperties()')).filter(k=>k.startsWith('BE_GHOST_')).length<=2,'45 nguồn chờ vẫn chỉ 1 property trạng thái');
// ===== B2: identity =====
run(`
function rec(sku,name,col,active){return {sku:sku,sourceId:"62",source:"mp",name:name,nameNorm:normalizeMasterText(name),column:col,aliases:[name],active:active,status:active?"ACTIVE":"REMOVED",created:new Date(),updated:new Date()};}
var ctx={records:[],bySourceId:{},skuSet:{},dirty:false};
[rec("VL-A","Villa A",3,true),rec("VL-B","Villa B",4,true),rec("VL-C","Villa C",5,true)].forEach(function(r){ctx.records.push(r);ctx.skuSet[r.sku]=true;(ctx.bySourceId["62"]=ctx.bySourceId["62"]||[]).push(r);});
var a1=beResolveSourceVillaIdentitiesV1_(ctx,"62","mp",[{name:"Villa A",sourceColumn:3},{name:"Villa B",sourceColumn:4}],{allowConfirmedRemoveAdd:true,confirmedRenamePairs:[]});
beFinalizeSourceVillaIdentitiesV1_(ctx,"62","mp",a1);
var cAfterRetire=ctx.records.filter(function(r){return r.sku==="VL-C";})[0];
var a2=beResolveSourceVillaIdentitiesV1_(ctx,"62","mp",[{name:"Villa A",sourceColumn:3},{name:"Villa B",sourceColumn:4},{name:"Villa C",sourceColumn:5}],{});
`);
assert(run('cAfterRetire.active')===false&&run('cAfterRetire.status')==='REMOVED','căn C bị ẩn: RETIRED trong sổ mã, không xóa');
assert(run('a2[2]&&a2[2].sku')==='VL-C'&&run('a2[2].mode')==='REVIVED_RETIRED_V1','căn C quay lại -> lấy lại đúng mã VL-C');
run(`beRegisterResolvedVillaIdentityV1_(ctx,"62","mp",{name:"Villa C",sourceColumn:5},"VL-C",a2[2]);`);
assert(run('cAfterRetire.active')===true&&run('cAfterRetire.status')==='REVIVED_RETIRED_V1','sổ mã: VL-C active lại, trạng thái REVIVED');
// Mã cũ không được cấp cho căn khác tên ở cùng cột
run(`var a3=beResolveSourceVillaIdentitiesV1_(ctx,"62","mp",[{name:"Villa A",sourceColumn:3},{name:"Villa B",sourceColumn:4},{name:"Villa Moi",sourceColumn:5}],{allowConfirmedRemoveAdd:true});`);
assert(!run('a3[2]'),'căn mới khác tên ở cột cũ của C -> KHÔNG nhận mã VL-C');
