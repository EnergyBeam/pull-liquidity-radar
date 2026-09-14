import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:p=>JSON.parse(readFileSync(new URL('../lib/'+p.replace('./',''),import.meta.url),'utf8')),Date,Math,Map,Number,Intl,URLSearchParams});return exports;}
const {parsePoolName,isUsdgPair,isTargetPair,pairAssets}=load('engine.ts');const {krystalPoolUrl,poolAppLink}=load('krystal.ts');
test('fee suffix does not exclude real USDG pools',()=>{
 for(const fee of ['0.7','0.3','1','0.01','0']){const p=parsePoolName('MEME / USDG '+fee+'%');assert.equal(p.quote,'USDG');assert.equal(p.feePercent,Number(fee));assert.ok(isUsdgPair(p));}
 assert.ok(isUsdgPair({symbol:'MEME',quote:'USDG 0.3%'}));
 assert.equal(parsePoolName('MEME / USDG').feePercent,null);
 assert.equal(isUsdgPair(parsePoolName('MEME / USDC 0.3%')),false);
});
test('Pons v2 bytes32 pools map to v4, not v2',()=>{
 const addr='0x5eac4195930d5ff8b7a34a347f2bde951c42eb730d6e26075bea3dd7c66feb40';
 const u=new URL(krystalPoolUrl('robinhood',addr,'pons-v2-dex'));assert.equal(u.searchParams.get('protocol'),'uniswapv4');assert.equal(u.searchParams.get('poolAddress'),addr);
 assert.equal(krystalPoolUrl('robinhood','0x'+'a'.repeat(40),'pons-v2-dex'),null);
});

test('pair filter uses the native quote asset of each network and USDG on Robinhood',()=>{
 for(const [chain,assets] of Object.entries(pairAssets))for(const asset of assets){
  assert.ok(isTargetPair({chain,symbol:'MEME',quote:asset+' 0.3%'}));
  assert.ok(isTargetPair({chain,symbol:asset,quote:'MEME'}));
 }
 for(const [chain,quote] of [['solana','USDG'],['bsc','SOL'],['base','BNB'],['robinhood','WETH'],['unknown','SOL']])assert.equal(isTargetPair({chain,symbol:'MEME',quote}),false);
});

test('Base accepts USDC on either side without changing other networks',()=>{
 assert.ok(isTargetPair({chain:'base',symbol:'MEME',quote:'USDC'}));
 assert.ok(isTargetPair({chain:'base',symbol:'USDC',quote:'MEME'}));
 assert.equal(isTargetPair({chain:'bsc',symbol:'MEME',quote:'USDC'}),false);
});
test('Solana pool links use Meteora and never Krystal',()=>{
 const address='B'.repeat(32);
 assert.equal(poolAppLink('solana',address,'meteora').url,'https://app.meteora.ag/dlmm/'+address);
 assert.equal(poolAppLink('solana',address,'meteora-damm-v2').url,'https://app.meteora.ag/dammv2/'+address);
 assert.equal(poolAppLink('solana',address,'raydium').url,null);
 assert.equal(poolAppLink('solana',address,'raydium').label,'Meteora');
});

test('Krystal protocol aliases include PancakeSwap and confirmed Aerodrome CL, never guess unversioned DEX',()=>{
 const addr='0x'+'a'.repeat(40);
 for(const [dex,protocol] of [['pancakeswap-v3','pancakev3'],['pancakeswap-v2','pancakev2'],['aerodrome-slipstream','aerodromecl'],['uniswap-v2','uniswapv2'],['sushiswap-v3','sushiv3']]){
  assert.equal(new URL(krystalPoolUrl('base',addr,dex)).searchParams.get('protocol'),protocol);
 }
 assert.equal(krystalPoolUrl('base',addr,'aerodrome'),null);
 assert.equal(krystalPoolUrl('base',addr,'pancakeswap'),null);
});
