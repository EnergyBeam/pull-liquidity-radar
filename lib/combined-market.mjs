// Both the Worker and local notifier use these exact address joins and units.
export const gmgnChain = chain => chain === 'solana' ? 'sol' : chain;
export const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export const addressKey = (chain,address) => chain === 'solana' ? String(address||'') : String(address||'').toLowerCase();
export function unwrapGmgn(data){
 for(let i=0;i<2&&data&&typeof data==='object'&&'code' in data;i++){
  if(data.code!==0)throw new Error('GMGN: запрос отклонён ('+String(data.code)+')');
  data=data.data;
 }
 return data;
}
export function candidates(hour,five){
 const out=new Map();
 // Interleave windows so a short burst can enter alongside established trends.
 for(let i=0;i<20;i++)for(const rows of [hour,five]){const t=rows[i];if(t?.address&&!out.has(t.address))out.set(t.address,t);if(out.size>=20)return [...out.values()];}
 return [...out.values()];
}
export function fromDexPair(p,chain,at,token){
 if(p.chainId!==chain||!p.pairAddress||!p.baseToken?.address||!p.quoteToken?.address)return null;
 const reverse=token&&addressKey(chain,token)===addressKey(chain,p.quoteToken.address);
 if(token&&!reverse&&addressKey(chain,token)!==addressKey(chain,p.baseToken.address))return null;
 const base=reverse?p.quoteToken:p.baseToken,quote=reverse?p.baseToken:p.quoteToken;
 const label=p.labels?.find(l=>/^v[234]$/.test(l));
 return {id:chain+':'+addressKey(chain,p.pairAddress),chain,address:p.pairAddress,token:base.address,symbol:base.symbol||'Token',quote:quote.symbol||'Token',dex:label?p.dexId+'-'+label:p.dexId,
 price:reverse?null:number(p.priceUsd),marketCap:reverse?null:number(p.marketCap),fdv:reverse?null:number(p.fdv),
 liquidity:number(p.liquidity?.usd),v5:number(p.volume?.m5),v15:null,v1:number(p.volume?.h1),v6:number(p.volume?.h6),v24:number(p.volume?.h24),
 change5:reverse?null:number(p.priceChange?.m5),change1:reverse?null:number(p.priceChange?.h1),change6:reverse?null:number(p.priceChange?.h6),buys:number(reverse?p.txns?.h1?.sells:p.txns?.h1?.buys),sells:number(reverse?p.txns?.h1?.buys:p.txns?.h1?.sells),createdAt:number(p.pairCreatedAt),fetchedAt:at,source:'DEX Screener',url:'https://dexscreener.com/'+chain+'/'+p.pairAddress};
}
export function normalizePools(chain,hour,five,pairs,at,tokenAt=at){
 const one=new Map(hour.map(t=>[addressKey(chain,t.address),t]));const short=new Map(five.map(t=>[addressKey(chain,t.address),t]));
 const wanted=new Set(candidates(hour,five).map(t=>addressKey(chain,t.address)));const out=new Map();
 for(const raw of pairs){
  const token=[raw.baseToken?.address,raw.quoteToken?.address].find(a=>a&&wanted.has(addressKey(chain,a)));if(!token)continue;
  const p=fromDexPair(raw,chain,at,token);if(!p)continue;
  const h=one.get(addressKey(chain,token)),f=short.get(addressKey(chain,token)),t=h||f;
  p.tokenV1=number(h?.volume);p.tokenV5=number(f?.volume);p.tokenFetchedAt=tokenAt;p.discoverySource='GMGN';
  if(at-tokenAt<=600000)p.marketCap=number(t?.market_cap)??p.marketCap;
  // Reverse pairs lack candidate price changes in DEX Screener; use explicitly-labelled token context only.
  if(addressKey(chain,token)!==addressKey(chain,raw.baseToken.address)){p.price=at-tokenAt<=600000?number(t?.price):null;}
  out.set(p.id,p);
 }
 return [...out.values()];
}
export function matchingFee(chain,pool,meta){
 if(!meta||addressKey(chain,meta.pool_address)!==addressKey(chain,pool))return null;
 const fee=number(meta.fee_ratio);return fee!==null&&fee>=0&&fee<=100?fee:null;
}
