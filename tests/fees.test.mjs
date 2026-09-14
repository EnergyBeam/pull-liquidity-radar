import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as normalize from '../lib/combined-market.mjs';
const compile=n=>ts.transpileModule(readFileSync(new URL('../lib/'+n+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const engine={};vm.runInNewContext(compile('engine'),{exports:engine});
const fees={};vm.runInNewContext(compile('pool-fees'),{exports:fees,require:p=>p==='./initial-fees.json'?{}:p==='./engine'?engine:p==='./combined-market.mjs'?normalize:{}});
test('fee metadata requires matching network and pool address, parses explicit percent including zero',()=>{
 const item=(chain,address,name)=>({id:chain+'_'+address,attributes:{address,name}});
 const result=fees.geckoFees('base',[item('base','0xABC','TOKEN / WETH 0.05%'),item('base','0xDEF','TOKEN / WETH 0%'),item('bsc','0xBAD','TOKEN / WBNB 1%'),item('base','0x123','TOKEN / WETH')],100);
 assert.equal(result['0xabc'].feePercent,0.05);assert.equal(result['0xdef'].feePercent,0);
 assert.equal(result['0xbad'],undefined);assert.equal(result['0x123'].feePercent,null);
});
test('Meteora uses total dynamic fee without adding base twice; validates exact address',()=>{
 const data={address:'AbC',dynamic_fee_pct:0.37,pool_config:{base_fee_pct:0.1}};
 assert.equal(fees.meteoraFee('AbC',data,100).feePercent,0.37);
 assert.equal(fees.meteoraFee('abc',data,100),null);
 assert.equal(fees.meteoraFee('AbC',{address:'AbC'},100),null);
});
