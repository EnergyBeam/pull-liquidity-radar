import {history} from '@/lib/market';
import {chains,type Chain,validAddress} from '@/lib/engine';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,chain=p.get('chain') as Chain,pool=p.get('pool')||'',token=p.get('token')||'';
 if(!chains.includes(chain)||!validAddress(pool)||!validAddress(token))return Response.json({error:'Некорректные параметры'},{status:400});
 try{return Response.json(await history(chain,pool,token));}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось получить график'},{status:502});}
}
