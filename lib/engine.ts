export type Chain='solana'|'robinhood'|'bsc'|'base';
export type Pool={lpDex?:string;feeCheckedAt?:number;feeKind?:string;tokenV1?:number|null;tokenV5?:number|null;tokenFetchedAt?:number;discoverySource?:string;feePercent?:number|null;feeSource?:string;feeNote?:string;marketCap?:number|null;fdv?:number|null;volumeSignal?:VolumeSignal;dataWarning?:string;id:string;chain:Chain;address:string;token:string;symbol:string;quote:string;dex:string;price:number|null;liquidity:number|null;v5:number|null;v15:number|null;v1:number|null;v6:number|null;v24:number|null;change5:number|null;change1:number|null;change6:number|null;buys:number|null;sells:number|null;createdAt:number|null;fetchedAt:number;source:string;url:string};
export type Candle=[number,number,number,number,number,number];
export type Features={change:number;range:number;direction:number;acceleration:number;active:number};
export const chains:Chain[]=['solana','robinhood','bsc','base'];
export const validAddress=(v:string)=>/^(0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(v);
export const finite=(x:unknown):number|null=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const clamp=(x:number)=>Math.max(0,Math.min(100,x));
export function features(candles:Candle[],asOf=Date.now()/1000):Features|null{
 const end=Math.floor(asOf/300)*300;
 const cs=[...new Map(candles.filter(c=>c[0]+300<=end&&c[0]>=end-3600&&c[1]>0&&c[3]>0&&c[4]>0).map(c=>[c[0],c])).values()].sort((a,b)=>a[0]-b[0]);
 if(cs.length<9||cs[0][0]>end-3000)return null;
 const a=cs[0][1],b=cs[cs.length-1][4];
 const path=[a,...cs.map(c=>c[4])];const distance=path.slice(1).reduce((s,v,i)=>s+Math.abs(Math.log(v/path[i])),0);
 const recent=cs.filter(c=>c[0]>=end-900).reduce((s,c)=>s+c[5],0);
 const prior=cs.filter(c=>c[0]<end-900).reduce((s,c)=>s+c[5],0);
 return {change:100*(b/a-1),range:100*(Math.max(...cs.map(c=>c[2]))/Math.min(...cs.map(c=>c[3]))-1),direction:distance?Math.abs(Math.log(b/a))/distance:0,acceleration:prior>0?recent/(prior/3):0,active:cs.length/12};
}
export function evaluate(p:Pool,capital:number,horizon:number,now=Date.now()){
 const missing:string[]=[];const reasons:string[]=[];
 const stale=now-p.fetchedAt>600000;
 if(stale)missing.push('Данные старше 10 минут');
 if(p.liquidity===null||p.liquidity<=0)missing.push('Ликвидность неизвестна');
 if(p.v1===null||p.v5===null)missing.push('Недостаточно данных объёма');
 if(p.v1!==null&&p.v5!==null&&p.v1<=p.v5)missing.push('Нет предыдущего объёма для сравнения');
 if(p.change1===null)missing.push('Нет изменения цены за час');
 const tvl=p.liquidity||0;
 const turnover=tvl&&p.v1!==null?p.v1/tvl:null;
 const accel=p.v1!==null&&p.v5!==null&&p.v1>p.v5?p.v5/((p.v1-p.v5)/11):null;
 const drift=Math.abs(p.change1||0);
 const capitalRatio=tvl?capital/tvl:1;
 const components={
 turnover:turnover===null?null:clamp(Math.log10(1+turnover*10)*65),
 persistence:accel===null?null:clamp(70-Math.abs(Math.log2(Math.max(.02,accel)))*24),
 range:p.change1===null?null:clamp(100-drift*(1+Math.sqrt(horizon)*1.5)),
 depth:tvl?clamp(100-capitalRatio*2000):null,
 };
 let score=missing.length?null:Math.round((components.turnover||0)*.30+(components.persistence||0)*.25+(components.range||0)*.30+(components.depth||0)*.15);
 if(p.v1!==null&&p.v1<1000){score=score===null?null:Math.min(score,35);reasons.push('Менее $1 000 оборота за час');}
 if(p.change1!==null&&p.change1< -15){score=score===null?null:Math.min(score,30);reasons.push('Сильное падение за час');}
 if(drift>30){score=score===null?null:Math.min(score,40);reasons.push('Быстрое направленное движение');}
 if(capitalRatio>.02){score=score===null?null:Math.min(score,25);reasons.push('Позиция больше 2% общей ликвидности');}
 if(accel!==null&&accel<.3)reasons.push('Последние 5 минут заметно тише предыдущих');
 if(accel!==null&&accel>4)reasons.push('Резкий всплеск; устойчивость ещё не подтверждена');
 if(p.createdAt&&now-p.createdAt<3600000)reasons.push('Пулу меньше часа');
 if(turnover!==null&&turnover>1)reasons.push('Часовой оборот выше текущего TVL');
 let regime='Наблюдение';
 if(missing.length)regime='Мало данных';
 else if(p.change1!==null&&p.change1< -15)regime='Распродажа';
 else if(drift>20)regime='Направленное движение';
 else if(accel!==null&&accel<.3)regime='Затухание';
 else if(accel!==null&&accel>4)regime='Всплеск';
 else if(drift<=5&&p.v1!==null&&p.v1>=1000)regime='Умеренный диапазон';
 return {score,components,regime,reasons,missing,turnover,accel,capitalRatio,stale};
}
export function money(n:number|null){return n===null?'н/д':new Intl.NumberFormat('ru-RU',{style:'currency',currency:'USD',notation:n>=10000?'compact':'standard',maximumFractionDigits:n<1?5:1}).format(n);}


export const isUsdgPair=(p:{symbol?:string;quote?:string})=>[p.symbol,p.quote].some(s=>s?.replace(/\s+\d+(?:\.\d+)?%\s*$/,'').trim().toUpperCase()==='USDG');

export type VolumeSignal={kind:'surge'|'fading'|'normal'|'unknown';ratio:number|null;peak:number;peakAt:number;at:number};
export function volumeImpulse(p:Pick<Pool,'v5'|'v1'|'fetchedAt'>,previous?:VolumeSignal,now=Date.now()):VolumeSignal{
 const blank:VolumeSignal={kind:'unknown',ratio:null,peak:previous?.peak||0,peakAt:previous?.peakAt||0,at:p.fetchedAt};
 if(now-p.fetchedAt>600000||p.fetchedAt>now+60000||p.v5===null||p.v1===null||p.v5<0||p.v1<=p.v5)return blank;
 if(previous&&p.fetchedAt<=previous.at)return previous;
 const ratio=p.v5/((p.v1-p.v5)/11),recent=!!previous&&p.fetchedAt-previous.peakAt<=3600000;
 let peak=recent?previous!.peak:0,peakAt=recent?previous!.peakAt:0;
 if(ratio>=3&&p.v5>=1000){if(p.v5>=peak){peak=p.v5;peakAt=p.fetchedAt;}return {kind:'surge',ratio,peak,peakAt,at:p.fetchedAt};}
 return {kind:recent&&peak>0&&p.v5<=peak*.25?'fading':'normal',ratio,peak,peakAt,at:p.fetchedAt};
}
export const volumeLabel=(s?:VolumeSignal)=>s?.kind==='surge'?'Резкий рост объёма':s?.kind==='fading'?'Затухание после всплеска':s?.kind==='normal'?'Обычный темп':'Нет данных об импульсе';

export function parsePoolName(name:string){
 const match=/\s+(\d+(?:\.\d+)?)%\s*$/.exec(name);
 const value=match?Number(match[1]):null;
 const feePercent=value!==null&&value>=0&&value<=100?value:null;
 const clean=match?name.slice(0,match.index):name;
 const parts=clean.split(' / ').map(s=>s.trim());
 return {symbol:parts[0]||'Token',quote:parts[1]||'',feePercent,feeSource:feePercent!==null?'GeckoTerminal: тариф в названии пула':undefined};
}

export const pairAssets:Record<string,readonly string[]>={solana:['SOL','WSOL'],bsc:['BNB','WBNB'],base:['ETH','WETH','USDC'],robinhood:['USDG']};
export const pairLabel=(chain:string)=>pairAssets[chain]?.join(' / ')||'SOL · BNB · ETH · USDC · USDG';
export const isTargetPair=(p:{chain?:string;symbol?:string;quote?:string})=>[p.symbol,p.quote].some(s=>(pairAssets[p.chain||'']||[]).includes(s?.replace(/\s+\d+(?:\.\d+)?%\s*$/,'').trim().toUpperCase()||''));
