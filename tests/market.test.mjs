import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const compile=name=>ts.transpileModule(readFileSync(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const js=compile('market'),storeJs=compile('snapshot-store');
const engine={};vm.runInNewContext(compile('engine'),{exports:engine});
function setup(initial={}){
 let now=1000000,status=200;const calls=[],jobs=[];const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../drizzle/0000_steep_jackal.sql',import.meta.url),'utf8'));
 const DB={prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}};
 const fakeDate=class extends Date{static now(){return now;}};
 const store={};vm.runInNewContext(storeJs,{exports:store,require:()=>({env:{DB}}),Date:fakeDate});
 const fetch=async url=>{calls.push(url);return status===200?Response.json({data:[url]}):new Response('{}',{status,headers:{'Retry-After':'180'}});};
 const handler=()=>{const exports={};vm.runInNewContext(js,{exports,require:p=>p==='./engine'?engine:p==='next/server'?{after:f=>jobs.push(f)}:p==='./snapshot-store'?store:p==='./combined-source'?{SourceError:class extends Error{}}:p==='./initial-market.json'?initial:{},fetch,Request,Response,AbortSignal,crypto:{randomUUID},process:{env:{NODE_ENV:'production'}},Date:fakeDate});return exports;};
 return {handler,store,calls,sql,tick:n=>now+=n,limit:s=>status=s,flush:async()=>{const tasks=jobs.splice(0);await Promise.all(tasks.map(f=>f()));},close:()=>sql.close()};
}
test('fresh snapshot is shared by separate handlers; stale reads return before one background fetch',async()=>{
 const s=setup();try{
 const a=s.handler(),b=s.handler();await a.upstream('gecko','/pools');await b.upstream('gecko','/pools');assert.equal(s.calls.length,1);
 s.tick(360000);const [one,two]=await Promise.all([a.upstream('gecko','/pools'),b.upstream('gecko','/pools')]);
 assert.equal(s.calls.length,1);assert.equal(a.observedAt(one),1000000);assert.equal(b.observedAt(two),1000000);
 await s.flush();assert.equal(s.calls.length,2);const fresh=await b.upstream('gecko','/pools');assert.equal(b.observedAt(fresh),1360000);
 }finally{s.close();}
});
test('429 cooldown is shared, preserves snapshot and obeys Retry-After',async()=>{
 const s=setup();try{
 const a=s.handler();await a.upstream('gecko','/pools');s.tick(360000);s.limit(429);
 await a.upstream('gecko','/pools');await s.flush();assert.equal(s.calls.length,2);
 const b=s.handler(),old=await b.upstream('gecko','/pools');assert.equal(b.observedAt(old),1000000);assert.match(b.observedWarning(old),/ограничил/);
 await s.flush();s.tick(1);await assert.rejects(b.upstream('gecko','/other'));assert.equal(s.calls.length,2);
 s.tick(181000);s.limit(200);await b.upstream('gecko','/pools');await s.flush();assert.equal(s.calls.length,3);
 assert.equal(b.observedAt(await b.upstream('gecko','/pools')),1541001);
 }finally{s.close();}
});
test('queue services oldest pending network even when another network triggers refresh',async()=>{
 const s=setup();try{
 await s.store.writeSnapshot('gecko/a',{data:['a']},1);await s.store.writeSnapshot('gecko/b',{data:['b']},1);
 const a=s.handler();await a.upstream('gecko','/a');s.tick(1);await a.upstream('gecko','/b');await s.flush();assert.equal(s.calls.length,1);assert.ok(s.calls[0].endsWith('/a'));
 s.tick(360000);await a.upstream('gecko','/a');await s.flush();assert.ok(s.calls[1].endsWith('/b'));assert.equal(s.calls.length,2);
 }finally{s.close();}
});
test('bundled public snapshot initializes empty DB without changing observation time',async()=>{
 const s=setup({'gecko/pools':{data:{data:['seed']},observedAt:100}});try{
 const a=s.handler(),data=await a.upstream('gecko','/pools');assert.equal(data.data[0],'seed');assert.equal(a.observedAt(data),100);assert.equal(s.calls.length,0);
 await s.store.writeSnapshot('gecko/pools',{data:['older']},99);assert.equal(JSON.parse((await s.store.readSnapshot('gecko/pools')).body).data[0],'seed');
 }finally{s.close();}
});
test('lease cannot be released by another owner and expires after a crashed worker',async()=>{
 const s=setup();try{
 assert.equal(await s.store.acquire('gecko','a',1000000),true);assert.equal(await s.store.acquire('gecko','b',1000000),false);
 await s.store.release('gecko','b');assert.equal(await s.store.acquire('gecko','b',1000001),false);assert.equal(await s.store.acquire('gecko','b',1030000),true);
 }finally{s.close();}
});

test('volume episodes persist between handlers using one state record per chain',async()=>{
 const s=setup();try{
 // Use real current time because engine freshness is measured independently.
 const at=Date.now();const base={id:'bsc:pool',chain:'bsc',v5:5000,v1:16000,fetchedAt:at};
 const a=s.handler();const [first]=await a.withVolumes([base]);assert.equal(first.volumeSignal.kind,'surge');
 const b=s.handler();const [second]=await b.withVolumes([{...base,v5:1000,v1:30000,fetchedAt:at+1000}]);assert.equal(second.volumeSignal.kind,'fading');
 assert.equal(s.sql.prepare("SELECT COUNT(*) AS n FROM market_snapshots WHERE key LIKE 'volume-state/%'").get().n,1);
 }finally{s.close();}
});
