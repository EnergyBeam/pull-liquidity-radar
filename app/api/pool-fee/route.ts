import {poolFee} from '@/lib/market';
import {chains,type Chain,validAddress} from '@/lib/engine';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,chain=p.get('chain') as Chain,token=p.get('token')||'',pool=p.get('pool')||'';
 if(!chains.includes(chain)||!validAddress(token)||!validAddress(pool))return Response.json({error:'Неверные параметры'},{status:400});
 try{return Response.json(await poolFee(chain,token,pool));}catch{return Response.json({feePercent:null,error:'Комиссия пока недоступна'},{status:502});}
}
