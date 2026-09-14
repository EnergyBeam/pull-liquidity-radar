import {providerStatus,setCooldown,readSnapshot,writeSnapshot} from './snapshot-store';
import {env} from 'cloudflare:workers';
import {addressKey,candidates,gmgnChain,normalizePools,unwrapGmgn} from './combined-market.mjs';
import {chains,type Chain,validAddress} from './engine';
export class SourceError extends Error{constructor(message:string,public retryAfter=0){super(message);}}
export async function requestSource(provider:'gmgn'|'dex',path:string,deadline=Date.now()+8000){
 const headers:Record<string,string>={Accept:'application/json','User-Agent':'PULL/1.0'};
 const url=new URL((provider==='gmgn'?'https://openapi.gmgn.ai':'https://api.dexscreener.com')+path);
 const status=await providerStatus(provider+'-api');if(status&&status.retry_after>Date.now())throw new SourceError(status.last_error||provider+': пауза источника',status.retry_after);
 if(provider==='gmgn'){
  const key=(env as unknown as {GMGN_API_KEY?:string}).GMGN_API_KEY||process.env.GMGN_API_KEY;
  if(!key)throw new SourceError('GMGN: API-ключ не подключён');
  headers['X-APIKEY']=key;url.searchParams.set('timestamp',String(Math.floor(Date.now()/1000)));url.searchParams.set('client_id',crypto.randomUUID());
 }
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});
 if(r.status===429){
  const body=await r.json().catch(()=>null) as {error?:unknown;reset_at?:unknown}|null;
  const code=typeof body?.error==='string'&&/^[A-Z0-9_]{1,80}$/.test(body.error)?body.error:'HTTP_429';
  const reset=Math.max(Number(r.headers.get('x-ratelimit-reset'))||0,Number(body?.reset_at)||0)*1000;
  const retryHeader=r.headers.get('Retry-After');
  const retry=retryHeader?(Number.isFinite(Number(retryHeader))?Number(retryHeader)*1000:Date.parse(retryHeader)-Date.now()):0;
  const until=Math.max(Date.now()+120000,Number.isFinite(reset)?reset:0,Date.now()+(Number.isFinite(retry)?retry:0));
  const message=provider+': '+code+'; повтор после '+new Date(until).toISOString();
  await setCooldown(provider+'-api',until,message);
  throw new SourceError(message,until);
 }
 if(!r.ok)throw new SourceError(provider+': источник недоступен ('+r.status+')');
 const body=await r.json();return provider==='gmgn'?unwrapGmgn(body):body;
}
export async function fetchCombined(path:string,fallback:Record<string,any>[]=[]){
 const [,network,feed]=path.split('/');if(!chains.includes(network as Chain)||!['trending','new'].includes(feed))throw new Error('Неверная выборка');
 const deadline=Date.now()+22000;
 const chain=network as Chain,g=gmgnChain(chain),sort=feed==='new'?'creation_timestamp':'volume';
 const rank=async(interval:string)=>{const d=await requestSource('gmgn','/v1/market/rank?'+new URLSearchParams({chain:g,interval,limit:'20',order_by:sort,direction:'desc'}),deadline);if(!Array.isArray(d?.rank))throw new Error('GMGN: нет списка кандидатов');return d.rank;};
 let hour:Record<string,any>[],five:Record<string,any>[],tokenAt:number,warning:string|undefined;
 try{
  const saved=await readSnapshot('rank'+path),cached=saved?JSON.parse(saved.body):null;
  if(saved&&Date.now()-saved.observed_at<300000){hour=cached.hour;five=cached.five;tokenAt=saved.observed_at;}
  else {hour=await rank('1h');await new Promise(r=>setTimeout(r,1100));five=await rank('5m');tokenAt=Date.now();await writeSnapshot('rank'+path,{hour,five},tokenAt);}
 }
 catch(error){
  if(!fallback.length)throw error;
  const tokens=[...new Map(fallback.filter(p=>validAddress(p.token)).map(p=>[p.token,p])).values()];
  hour=tokens.map(p=>({address:p.token,volume:p.tokenV1,market_cap:p.marketCap,price:p.price}));
  five=tokens.map(p=>({address:p.token,volume:p.tokenV5,market_cap:p.marketCap,price:p.price}));
  tokenAt=Math.min(...tokens.map(p=>p.tokenFetchedAt||p.fetchedAt));
  warning='GMGN временно недоступен: кандидаты и общий объём токена из сохранённой выборки. Обновление показателей пулов выполняется отдельно через DEX Screener.';
 }

 const list=candidates(hour,five).filter(t=>validAddress(t.address));
 const records=await Promise.all(list.map(async t=>{
  const key='dex-token/'+chain+'/'+addressKey(chain,t.address),saved=await readSnapshot(key);
  const pools=saved?JSON.parse(saved.body).pools:fallback.filter(p=>addressKey(chain,p.token)===addressKey(chain,t.address));
  return {t,key,pools,at:saved?.observed_at||Math.min(...pools.map((p:any)=>p.fetchedAt),0)};
 }));
 let requests=0,retryAt=0;
 // Checkpoint every token. A later failure cannot discard earlier successful data.
 for(const rec of [...records].sort((a,b)=>a.at-b.at)){
  if(Date.now()-rec.at<120000)continue;
  if(requests>=3||deadline-Date.now()<8500)break;
  if(requests)await new Promise(r=>setTimeout(r,2500));
  requests++;
  try{
   const raw=await requestSource('dex','/token-pairs/v1/'+chain+'/'+rec.t.address,deadline);
   if(!Array.isArray(raw))throw new Error('DEX Screener: неверный ответ');
   rec.at=Date.now();rec.pools=normalizePools(chain,hour,five,raw,rec.at,tokenAt);
   await writeSnapshot(rec.key,{pools:rec.pools},rec.at);
  }catch(error){
   retryAt=error instanceof SourceError?error.retryAfter:Date.now()+30000;
   warning=[warning,'DEX Screener: часть пулов ожидает обновления; успешные ответы сохранены.'].filter(Boolean).join(' ');
   break;
  }
 }
 const joined=new Map<string,any>();
 for(const rec of records)for(const p of rec.pools){
  const previous=joined.get(p.id);if(!previous||p.fetchedAt>previous.fetchedAt)joined.set(p.id,p);
 }
 const data=[...joined.values()],pending=records.some(r=>Date.now()-r.at>=120000);
 if(pending&&!retryAt)warning=[warning,'Пулы обновляются порциями; время данных указано для каждого пула.'].filter(Boolean).join(' ');
 return {warning,data:feed==='new'?data.filter(p=>p.createdAt!==null&&Date.now()-p.createdAt<=86400000):data,candidates:list.length,
  nextRefreshAt:pending?Math.max(Date.now()+30000,retryAt):Date.now()+120000};
}
