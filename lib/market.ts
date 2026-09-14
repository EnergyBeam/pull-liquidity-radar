import {type Chain,type Pool,type Candle,finite,validAddress,volumeImpulse,type VolumeSignal,parsePoolName} from './engine';
import {fetchCombined,requestSource,SourceError} from './combined-source';
import {addressKey,fromDexPair,gmgnChain,matchingFee} from './combined-market.mjs';
type Obj=Record<string,any>;
import {after} from 'next/server';
import initialMarket from './initial-market.json';
import initialCombined from './initial-combined.json';
import {readSnapshot,writeSnapshot,acquire,release,providerStatus,enqueue,nextJob,finishJob} from './snapshot-store';
const observed=new WeakMap<object,number>();
const warnings=new WeakMap<object,string>();
export const observedAt=(data:object)=>observed.get(data)??Date.now();
export const observedWarning=(data:object)=>warnings.get(data);
export async function upstream(provider:'gecko'|'dex'|'combined'|'gmgn',path:string,ttl=120000):Promise<any>{
 const key=provider+path;
 const initial=(initialCombined as Record<string,{data:unknown;observedAt:number}>)[key]||(initialMarket as Record<string,{data:unknown;observedAt:number}>)[key];
 let saved=await readSnapshot(key);
 if(!saved&&initial){await writeSnapshot(key,initial.data,initial.observedAt);saved=await readSnapshot(key);}
 const restore=(snapshot:{body:string;observed_at:number},warning?:string)=>{
  const data=JSON.parse(snapshot.body);if(data&&typeof data==='object'){observed.set(data,snapshot.observed_at);if(warning)warnings.set(data,warning);}return data;
 };
 const isFresh=(snapshot:{body:string;observed_at:number},age:number)=>{const next=provider==='combined'?JSON.parse(snapshot.body).nextRefreshAt:null;return next?Date.now()<next:Date.now()-snapshot.observed_at<age;};
 if(saved&&isFresh(saved,ttl))return restore(saved);
 await enqueue(key,provider,ttl);
 const refresh=async()=>{
  const owner=crypto.randomUUID();
  if(!await acquire(provider,owner,Date.now()))return null;
  let retryAfter=0,error:string|null=null,jobKey:string|undefined,rateLimited=false;
  try{
   const job=await nextJob(provider);
   if(!job)return null;
   jobKey=job.key;
   const latest=await readSnapshot(job.key);
   if(latest&&isFresh(latest,job.ttl)){await finishJob(job.key);return null;}
   const jobPath=job.key.slice(provider.length);
   if(provider==='combined'||provider==='gmgn'||provider==='dex'){
    const data=provider==='combined'?await fetchCombined(jobPath,latest?JSON.parse(latest.body).data||[]:[]):await requestSource(provider,jobPath);const at=Date.now();await writeSnapshot(job.key,data,at);await finishJob(job.key);return job.key===key?{body:JSON.stringify(data),observed_at:at}:null;
   }
   const origins={gecko:'https://api.geckoterminal.com/api/v2',dex:'https://api.dexscreener.com'};
   const url=process.env.NODE_ENV==='development'?'http://127.0.0.1:18766/'+provider+jobPath:origins[provider]+jobPath;
   const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'PULL/1.0'},signal:AbortSignal.timeout(18000)});
   if(response.status===429){
    rateLimited=true;
    const h=response.headers.get('Retry-After'),seconds=Number(h);const wait=h?(Number.isFinite(seconds)?seconds*1000:Date.parse(h)-Date.now()):120000;
    retryAfter=Date.now()+Math.max(120000,Number.isFinite(wait)?wait:120000);
    throw new Error('Источник ограничил запросы; сохранённая выборка доступна, повтор после паузы.');
   }
   if(!response.ok)throw new Error('Источник недоступен ('+response.status+').');
   const data=await response.json();const at=Date.now();
   await writeSnapshot(job.key,data,at);
   await finishJob(job.key);
   return job.key===key?{body:JSON.stringify(data),observed_at:at}:null;
  }catch(e){if(e instanceof SourceError&&e.retryAfter){rateLimited=true;retryAfter=e.retryAfter;}error=e instanceof Error?e.message:'Ошибка источника';retryAfter=retryAfter||Date.now()+60000;if(jobKey&&!rateLimited)await finishJob(jobKey);return null;}
  finally{await release(provider,owner,retryAfter,error);}
 };
 if(saved){
  after(async()=>{try{await refresh();}catch{/* Snapshot remains readable even if refresh fails. */}});
  const status=await providerStatus(provider);
  return restore(saved,status?.last_error||'Показана общая сохранённая выборка; обновление выполняется в фоне.');
 }
 const fresh=await refresh();
 if(fresh)return restore(fresh);
 const available=await readSnapshot(key);if(available)return restore(available);
 const status=await providerStatus(provider);
 throw new Error(status?.last_error||'Первая общая выборка ещё готовится. Повторите после автоматического обновления.');
}

function addr(id:string,chain:string){return id?.startsWith(chain+'_')?id.slice(chain.length+1):id||'';}
export function fromGecko(item:Obj,chain:Chain,fetchedAt:number):Pool{
 const a=item.attributes||{},rel=item.relationships||{};
 const parsed=parsePoolName(String(a.name||'Token / Token'));
 const pons=chain==='robinhood'&&rel.dex?.data?.id==='pons-v2-dex'&&/^0x[0-9a-fA-F]{64}$/.test(a.address);
 const fee=pons?{feePercent:0,feeSource:'Pons V2: документация протокола',feeNote:'LP-тариф 0%. Hook взимает отдельные сборы в пользу протокола и создателя; они не являются комиссией LP.'}:{feePercent:parsed.feePercent,feeSource:parsed.feeSource,feeNote:'Тариф источника; дополнительные сборы hook/протокола не учтены.'};
 const v=a.volume_usd||{},c=a.price_change_percentage||{},t=a.transactions?.h1||{};
 return {...fee,id:chain+':'+(chain==='solana'?a.address:a.address.toLowerCase()),chain,address:a.address,token:addr(rel.base_token?.data?.id,chain),symbol:parsed.symbol,quote:parsed.quote,dex:rel.dex?.data?.id||'',marketCap:finite(a.market_cap_usd),fdv:finite(a.fdv_usd),price:finite(a.base_token_price_usd),liquidity:finite(a.reserve_in_usd),v5:finite(v.m5),v15:finite(v.m15),v1:finite(v.h1),v6:finite(v.h6),v24:finite(v.h24),change5:finite(c.m5),change1:finite(c.h1),change6:finite(c.h6),buys:finite(t.buys),sells:finite(t.sells),createdAt:a.pool_created_at?Date.parse(a.pool_created_at):null,fetchedAt,source:'GeckoTerminal',url:'https://www.geckoterminal.com/'+chain+'/pools/'+a.address};
}
export async function discover(chain:Chain,feed:'trending'|'new'){
 const data=await upstream('combined','/'+chain+'/'+feed);
 return (data.data||[]).map((p:Pool)=>({...p,dataWarning:observedWarning(data)||data.warning})) as Pool[];
}
export async function findToken(chain:Chain,token:string){
 const data=await upstream('dex','/token-pairs/v1/'+chain+'/'+token);
 return (Array.isArray(data)?data:[]).map((p:Obj)=>fromDexPair(p,chain,observedAt(data),token)).filter((p):p is NonNullable<typeof p>=>p!==null).map(p=>({...p,dataWarning:observedWarning(data)})) as Pool[];
}
export async function findPools(chain:Chain,ids:string[]){
 const data=await upstream('dex','/latest/dex/pairs/'+chain+'/'+ids.join(','));
 return ((data.pairs||[]) as Obj[]).map((p:Obj)=>fromDexPair(p,chain,observedAt(data),undefined)).filter((p):p is NonNullable<typeof p>=>p!==null).map(p=>({...p,dataWarning:observedWarning(data)})) as Pool[];
}
export async function poolFee(chain:Chain,token:string,pool:string){
 const saved=await readSnapshot('pool-fees/'+chain),fee=saved?JSON.parse(saved.body)[addressKey(chain,pool)]:null;
 if(fee?.feePercent!=null&&Date.now()-fee.feeCheckedAt<(fee.feeKind==='dynamic'?120000:3600000))return fee;
 const data=await upstream('gmgn','/v1/token/pool_info?'+new URLSearchParams({chain:gmgnChain(chain),address:token}),3600000);
 return {feePercent:matchingFee(chain,pool,data),feeSource:'GMGN · точное совпадение адреса пула'};
}
export async function history(chain:Chain,pool:string,token:string){
 if(!validAddress(pool)||!validAddress(token))throw new Error('Неверный адрес');
 const data=await upstream('gecko','/networks/'+chain+'/pools/'+pool+'/ohlcv/minute?aggregate=5&limit=100&currency=usd&token='+token,300000);
 const tokens=[data.meta?.base,data.meta?.quote].filter(Boolean);
 const matches=tokens.some((t:Obj)=>chain==='solana'?t.address===token:t.address?.toLowerCase()===token.toLowerCase());
 if(!matches)throw new Error('Источник не подтвердил адрес токена в паре');
 const raw=(data.data?.attributes?.ohlcv_list||[]) as Candle[];
 const cs=[...new Map([...raw].reverse().map(c=>[c[0],c])).values()].filter(c=>c.length===6&&c.every(Number.isFinite)&&c[0]+300<=Date.now()/1000&&c[1]>0&&c[3]>0&&c[4]>0&&c[5]>=0).sort((a,b)=>a[0]-b[0]);
 return {candles:cs,token,quote:tokens.find((t:Obj)=>t.address!==token)?.symbol,source:'GeckoTerminal',fetchedAt:observedAt(data)};
}



// One durable state record per network, rather than a cache request per pool.
export async function withVolumes(pools:Pool[]):Promise<Pool[]>{
 const signals=new Map<string,VolumeSignal>();
 for(const chain of new Set(pools.map(p=>p.chain))){
  const key='volume-state/'+chain,saved=await readSnapshot(key);
  let states:Record<string,VolumeSignal>={};try{states=saved?JSON.parse(saved.body):{};}catch{}
  states=Object.fromEntries(Object.entries(states).filter(([,v])=>Date.now()-v.at<7200000));
  let at=saved?.observed_at||0,changed=false;
  for(const p of pools.filter(p=>p.chain===chain)){
   const previous=states[p.id],signal=volumeImpulse(p,previous);signals.set(p.id,signal);
   if(p.fetchedAt>(previous?.at||0)&&Date.now()-p.fetchedAt<=600000){states[p.id]=signal;at=Math.max(at,p.fetchedAt);changed=true;}
  }
  if(changed)await writeSnapshot(key,states,at);
 }
 return pools.map(p=>({...p,volumeSignal:signals.get(p.id)}));
}
