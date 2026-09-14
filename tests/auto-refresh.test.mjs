import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/auto-refresh.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('polls visible page, resumes immediately, skips active requests and removes listeners',()=>{
 let now=100000,busy=false,calls=0,timer,cleared=false;const listeners=new Map();
 const surface={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 const doc={...surface,visibilityState:'visible'},win={...surface,setInterval:(fn,ms)=>{assert.equal(ms,30000);timer=fn;return 1;},clearInterval:()=>cleared=true};
 const stop=exports.startAutoRefresh(doc,win,()=>calls++,()=>busy,()=>now);
 timer();assert.equal(calls,1);now+=30000;busy=true;timer();assert.equal(calls,1);
 busy=false;doc.visibilityState='hidden';timer();assert.equal(calls,1);
 doc.visibilityState='visible';listeners.get('visibilitychange')();assert.equal(calls,2);listeners.get('focus')();assert.equal(calls,2);
 now+=15000;listeners.get('focus')();assert.equal(calls,2);now+=15000;timer();assert.equal(calls,3);now+=30000;listeners.get('online')();assert.equal(calls,4);
 stop();assert.ok(cleared);assert.equal(listeners.size,0);
});
