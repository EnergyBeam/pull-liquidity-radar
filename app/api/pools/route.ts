import {chains,type Chain,validAddress,isTargetPair} from '@/lib/engine';
import {withFees} from '@/lib/pool-fees';
import {discover,findToken,findPools,withVolumes} from '@/lib/market';
export async function GET(request:Request){
 const params=new URL(request.url).searchParams;const network=params.get('chain')||'solana';const token=params.get('token')?.trim();const feed=params.get('feed')==='new'?'new':'trending';const ids=params.get('ids')?.split(',')||[];
 if(network!=='all'&&!chains.includes(network as Chain))return Response.json({error:'Неизвестная сеть'},{status:400});
 if(token&&(!validAddress(token)||network==='all'))return Response.json({error:'Укажите сеть и корректный адрес токена'},{status:400});
 if(ids.length&&(network==='all'||ids.length>10||ids.some(id=>!validAddress(id))))return Response.json({error:'Не более 10 корректных адресов одной сети'},{status:400});
 const list=network==='all'?chains:[network as Chain];
 const results=await Promise.allSettled(list.map(async c=>{
 if(ids.length)return findPools(c,ids);
 return token?findToken(c,token):discover(c,feed);
 }));
 const pools=await withFees(await withVolumes(results.flatMap(r=>r.status==='fulfilled'?r.value:[]).filter(isTargetPair)));
 const errors:{chain:string;message:string}[]=results.flatMap((r,i)=>r.status==='rejected'?[{chain:list[i],message:r.reason instanceof Error?r.reason.message:'Нет данных'}]:[]);
 for(const message of new Set(pools.map(p=>p.dataWarning).filter(Boolean)))errors.push({chain:'',message:message!});
 return Response.json({pools,errors,fetchedAt:Date.now(),coverage:'Выборка '+(ids.length?'избранных':token?'пулов токена':feed==='new'?'новых (до 24ч) пулов кандидатов GMGN':'пулов трендовых токенов GMGN')+' · фильтр пары по сети; не весь рынок'},{status:pools.length||!errors.length?200:502,headers:{'Cache-Control':'no-store'}});
}

