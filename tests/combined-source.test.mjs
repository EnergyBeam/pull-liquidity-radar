import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import * as normalize from '../lib/combined-market.mjs';
test('GMGN cooldown does not stop fresh DEX pool data or relabel stale token volume',async()=>{
 const code=ts.transpileModule(readFileSync(new URL('../lib/combined-source.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let gmgnCalls=0,dexCalls=0,status={},snapshots={};const exports={};const token='0x'+'a'.repeat(40),quote='0x'+'b'.repeat(40),old=Date.now()-3600000;
 const pair={chainId:'bsc',pairAddress:'0x'+'c'.repeat(40),baseToken:{address:token,symbol:'MEME'},quoteToken:{address:quote,symbol:'WBNB'},volume:{m5:100,h1:2000},liquidity:{usd:40000},marketCap:300000};
 vm.runInNewContext(code,{exports,URL,URLSearchParams,AbortSignal,Date,setTimeout,crypto:{randomUUID},process:{env:{}},require:p=>p==='cloudflare:workers'?{env:{GMGN_API_KEY:'synthetic-key'}}:p==='./snapshot-store'?{readSnapshot:async k=>snapshots[k],writeSnapshot:async(k,data,at)=>snapshots[k]={body:JSON.stringify(data),observed_at:at},providerStatus:async p=>status[p],setCooldown:async(p,until,message)=>status[p]={retry_after:until,last_error:message}}:p==='./engine'?{chains:['bsc'],validAddress:s=>/^0x[a-f0-9]{40}$/.test(s)}:normalize,fetch:async url=>{if(url.hostname==='openapi.gmgn.ai'){gmgnCalls++;return Response.json({error:'RATE_LIMIT_BANNED',reset_at:Math.floor(Date.now()/1000)+180},{status:429});}dexCalls++;return Response.json([pair]);}});
 const previous=[{token,tokenV1:99999,tokenV5:5555,marketCap:1,tokenFetchedAt:old,fetchedAt:old}];
 for(let i=0;i<2;i++){
  const result=await exports.fetchCombined('/bsc/trending',previous),p=result.data[0];assert.equal(p.v1,2000);assert.equal(p.tokenV1,99999);assert.equal(p.tokenFetchedAt,old);assert.ok(p.fetchedAt>old);assert.equal(p.marketCap,300000);assert.match(result.warning,/GMGN/);
 }
 assert.equal(gmgnCalls,1);assert.equal(dexCalls,1);
});


test('DEX 429 is shared across calls and respects an HTTP-date Retry-After',async()=>{
 const code=ts.transpileModule(readFileSync(new URL('../lib/combined-source.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={},statuses={};let calls=0;const until=Math.floor(Date.now()/1000)*1000+600000;
 vm.runInNewContext(code,{exports,URL,URLSearchParams,AbortSignal,Date,setTimeout,crypto:{randomUUID},process:{env:{}},require:p=>p==='cloudflare:workers'?{env:{}}:p==='./snapshot-store'?{providerStatus:async p=>statuses[p],setCooldown:async(p,at,message)=>statuses[p]={retry_after:at,last_error:message}}:normalize,fetch:async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':new Date(until).toUTCString()}});}});
 await assert.rejects(exports.requestSource('dex','/token-pairs/v1/bsc/a'),e=>e.retryAfter===until);
 await assert.rejects(exports.requestSource('dex','/latest/dex/pairs/bsc/b'),e=>e.retryAfter===until);
 assert.equal(calls,1);assert.equal(statuses['gmgn-api'],undefined);
});


test('partial DEX progress survives 429 and next pass resumes missing tokens without refetching completed ones',async()=>{
 const code=ts.transpileModule(readFileSync(new URL('../lib/combined-source.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={},snapshots={},calls=[];let limited=true;
 const tokens=[1,2,3,4,5].map(n=>'0x'+String(n).repeat(40)),old=Date.now()-3600000;
 const previous=tokens.map(token=>({id:'bsc:'+token,chain:'bsc',address:token,token,fetchedAt:old,tokenFetchedAt:old,v1:1}));
 vm.runInNewContext(code,{exports,URL,URLSearchParams,AbortSignal,Date,setTimeout:f=>f(),crypto:{randomUUID},process:{env:{}},
 require:p=>p==='cloudflare:workers'?{env:{}}:p==='./snapshot-store'?{readSnapshot:async k=>snapshots[k],writeSnapshot:async(k,data,at)=>snapshots[k]={body:JSON.stringify(data),observed_at:at},providerStatus:async()=>null,setCooldown:async()=>{}}:p==='./engine'?{chains:['bsc'],validAddress:s=>/^0x[a-f0-9]{40}$/.test(s)}:normalize,
 fetch:async url=>{const token=url.pathname.split('/').at(-1);calls.push(token);if(limited&&token===tokens[1])return new Response('{}',{status:429});return Response.json([{chainId:'bsc',pairAddress:token,baseToken:{address:token,symbol:'T'},quoteToken:{address:'0x'+'a'.repeat(40),symbol:'WBNB'},volume:{h1:900}}]);}});
 const first=await exports.fetchCombined('/bsc/trending',previous);
 assert.equal(first.data.find(p=>p.token===tokens[0]).v1,900);
 assert.equal(first.data.find(p=>p.token===tokens[1]).fetchedAt,old);
 assert.ok(snapshots['dex-token/bsc/'+tokens[0]]);
 limited=false;const second=await exports.fetchCombined('/bsc/trending',first.data);
 assert.equal(calls.filter(t=>t===tokens[0]).length,1);
 assert.equal(calls.length,5); // 2 in interrupted pass, at most 3 in resumed pass.
 assert.equal(second.data.find(p=>p.token===tokens[4]).fetchedAt,old);
});
