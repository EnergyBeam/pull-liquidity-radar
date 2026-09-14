import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/engine.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Date,Math,Map,Number,Intl});
const {volumeImpulse}=exports;const p=(v5,v1,at)=>({v5,v1,fetchedAt:at});
test('spike and subsequent collapse are ordered observations',()=>{
 const spike=volumeImpulse(p(5000,16000,1000000),undefined,1000000);assert.equal(spike.kind,'surge');assert.equal(spike.ratio,5);
 const faded=volumeImpulse(p(1000,30000,1300000),spike,1300000);assert.equal(faded.kind,'fading');
 assert.equal(volumeImpulse(p(1000,30000,1300000),undefined,1300000).kind,'normal');
});
test('missing baseline, tiny spikes and stale snapshots do not trigger',()=>{
 assert.equal(volumeImpulse(p(1000,1000,1000000),undefined,1000000).kind,'unknown');
 assert.equal(volumeImpulse(p(500,1000,1000000),undefined,1000000).kind,'normal');
 assert.equal(volumeImpulse(p(5000,16000,1000000),undefined,2000000).kind,'unknown');
});
test('repeated cached snapshots do not advance peak history',()=>{
 const first=volumeImpulse(p(5000,16000,1000000),undefined,1000000);
 assert.deepEqual(volumeImpulse(p(5000,16000,1000000),first,1000200),first);
 assert.equal(volumeImpulse(p(1000,30000,5000000),first,5000000).kind,'normal');
});
