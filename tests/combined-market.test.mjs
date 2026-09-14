import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePools,matchingFee,unwrapGmgn,candidates} from '../lib/combined-market.mjs';
const pair=(id='pool',chain='bsc')=>({chainId:chain,pairAddress:id,baseToken:{address:'0xAbC',symbol:'MEME'},quoteToken:{address:'0xDef',symbol:'WBNB'},volume:{m5:100,h1:1000},liquidity:{usd:5000},priceUsd:'1',priceChange:{m5:1,h1:2},dexId:'uniswap',labels:['v3']});
test('pool turnover stays distinct from total token turnover and one token can have many pools',()=>{
 const result=normalizePools('bsc',[{address:'0xabc',volume:900000}],[{address:'0xABC',volume:40000}],[pair('a'),pair('b'),pair('a')],200,100);
 assert.equal(result.length,2);for(const p of result){assert.equal(p.v1,1000);assert.equal(p.v5,100);assert.equal(p.liquidity,5000);assert.equal(p.tokenV1,900000);assert.equal(p.tokenV5,40000);assert.equal(p.tokenFetchedAt,100);assert.equal(p.fetchedAt,200);}
});
test('network and contract identity are required; no join by symbol',()=>{
 assert.equal(normalizePools('bsc',[{address:'0xabc'}],[],[pair('a','base')],1).length,0);
 assert.equal(normalizePools('bsc',[{address:'different',symbol:'MEME'}],[],[pair()],1).length,0);
 const p=pair('a','solana');assert.equal(normalizePools('solana',[{address:'0xabc'}],[],[p],1).length,0);
});
test('missing pool volume never inherits token volume; reversed token has no invented price change',()=>{
 const raw=pair();delete raw.volume;
 const p=normalizePools('bsc',[{address:'0xdef',volume:10000,price:3}],[],[raw],1)[0];
 assert.equal(p.token,'0xDef');assert.equal(p.v1,null);assert.equal(p.change1,null);assert.equal(p.price,3);
});
test('fee applies only to matching pool and is already a percent',()=>{
 assert.equal(matchingFee('bsc','ABC',{pool_address:'abc',fee_ratio:'0.1'}),.1);
 assert.equal(matchingFee('bsc','other',{pool_address:'abc',fee_ratio:'0.1'}),null);
 assert.equal(matchingFee('solana','ABC',{pool_address:'abc',fee_ratio:'0.1'}),null);
 assert.equal(matchingFee('bsc','abc',{pool_address:'abc',fee_ratio:'0'}),0);
});
test('GMGN nested failures are not accepted as empty rankings',()=>{
 assert.throws(()=>unwrapGmgn({code:0,data:{code:401,data:null}}));
 assert.deepEqual(unwrapGmgn({code:0,data:{code:0,data:{rank:[]}}}),{rank:[]});
 assert.equal(candidates(Array.from({length:30},(_,i)=>({address:'a'+i})),[]).length,20);
});
