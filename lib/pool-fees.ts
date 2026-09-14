import initialFees from './initial-fees.json';
import {after} from 'next/server';
import {type Pool,type Chain,parsePoolName,finite} from './engine';
import {addressKey} from './combined-market.mjs';
import {readSnapshot,writeSnapshot,acquire,release} from './snapshot-store';
type Fee={lpDex?:string;feePercent:number|null;feeSource?:string;feeNote?:string;feeCheckedAt:number;feeKind?:string};
export function geckoFees(chain:Chain,items:any[],at:number):Record<string,Fee>{
 const result:Record<string,Fee>={};
 for(const item of items){
  const a=item.attributes;if(!a?.address||item.id!==chain+'_'+a.address)continue;
  const parsed=parsePoolName(a.name||'');
  result[addressKey(chain,a.address)]={lpDex:item.relationships?.dex?.data?.id,feePercent:parsed.feePercent,feeSource:parsed.feeSource,feeCheckedAt:at,feeNote:'Тариф указан в метаданных этого пула; дополнительные сборы hook не учтены.'};
 }
 return result;
}
export function meteoraFee(pool:string,body:any,at:number):Fee|null{
 const value=finite(body?.dynamic_fee_pct);
 if(body?.address!==pool||value===null||value<0||value>100)return null;
 return {feePercent:value,feeKind:'dynamic',feeSource:'Meteora DLMM · текущая комиссия',feeCheckedAt:at,feeNote:'Базовая плюс переменная комиссия на момент проверки; может изменяться.'};
}
export async function withFees(pools:Pool[]):Promise<Pool[]>{
 const output:Pool[]=[];
 for(const chain of new Set(pools.map(p=>p.chain))){
  const key='pool-fees/'+chain,saved=await readSnapshot(key);
  const seed=initialFees[chain],state:Record<string,Fee>=geckoFees(chain,seed.items,seed.at);
  for(const [id,fee] of Object.entries(saved?JSON.parse(saved.body):{}) as [string,Fee][])state[id]={...state[id],...fee};
  const rows=pools.filter(p=>p.chain===chain);
  const due=rows.filter(p=>!state[addressKey(chain,p.address)]||Date.now()-state[addressKey(chain,p.address)].feeCheckedAt>(state[addressKey(chain,p.address)].feeKind==='dynamic'?120000:3600000)).sort((a,b)=>(b.liquidity||0)-(a.liquidity||0)).slice(0,20);
  if(due.length)after(async()=>{
   const owner=crypto.randomUUID(),provider='fee-refresh/'+chain;if(!await acquire(provider,owner,Date.now()))return;
   try{
    const response=await fetch('https://api.geckoterminal.com/api/v2/networks/'+chain+'/pools/multi/'+due.map(p=>p.address).join(','),{headers:{Accept:'application/json','User-Agent':'PULL/1.0'},signal:AbortSignal.timeout(8000)});
    if(!response.ok){await writeSnapshot('fee-status/'+chain,{message:'Источник тарифов: HTTP '+response.status},Date.now());return;}
    const body=await response.json() as {data?:any[]};if(!Array.isArray(body.data))return;
    const at=Date.now(),found=geckoFees(chain,body.data,at);
    const latest=await readSnapshot(key),merged:Record<string,Fee>=latest?JSON.parse(latest.body):{};
    for(const p of due){const id=addressKey(chain,p.address);merged[id]=found[id]||{feePercent:null,feeCheckedAt:at,feeNote:'Источник пока не сообщил тариф этого пула.'};}
    // The official DLMM API reports the current total fee, not just its base component.
    for(const p of due.filter(p=>chain==='solana'&&p.dex==='meteora').slice(0,2)){
     try{const r=await fetch('https://dlmm.datapi.meteora.ag/pools/'+p.address,{signal:AbortSignal.timeout(5000)});if(r.ok){const fee=meteoraFee(p.address,await r.json(),Date.now());if(fee)merged[p.address]=fee;}}catch{}
    }
    await writeSnapshot(key,merged,Date.now());await writeSnapshot('fee-status/'+chain,{message:null},Date.now());
   }catch{/* Keep confirmed fees when the metadata source is unavailable. */}finally{await release(provider,owner,Date.now()+60000);}
  });
  output.push(...rows.map(p=>{const fee=state[addressKey(chain,p.address)];return fee?{...p,...fee,feeNote:(fee.feeNote||'')+(Date.now()-fee.feeCheckedAt>3600000?' Сохранённый тариф: требуется повторная проверка.':'')}:{...p,feeNote:'Тариф этого пула загружается в фоне.'};}));
 }
 return output;
}
