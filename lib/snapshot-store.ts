import {env} from 'cloudflare:workers';
export const database=()=>{
 const db=(env as unknown as {DB?:D1Database}).DB;
 if(!db)throw new Error('Общая база ещё не подключена');
 return db;
};
export type Snapshot={body:string;observed_at:number};
export const readSnapshot=(key:string)=>database().prepare('SELECT body,observed_at FROM market_snapshots WHERE key=?').bind(key).first<Snapshot>();
export async function writeSnapshot(key:string,data:unknown,at:number){
 await database().prepare('INSERT INTO market_snapshots(key,body,observed_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at WHERE excluded.observed_at>market_snapshots.observed_at').bind(key,JSON.stringify(data),at).run();
}
export async function acquire(provider:string,owner:string,now:number){
 const r=await database().prepare('INSERT INTO market_providers(id,owner,lease_until,retry_after) VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until WHERE market_providers.lease_until<=? AND market_providers.retry_after<=?').bind(provider,owner,now+30000,now,now).run();
 return r.meta.changes===1;
}
export async function release(provider:string,owner:string,retryAfter=0,error:string|null=null){
 await database().prepare('UPDATE market_providers SET lease_until=?,retry_after=?,last_error=? WHERE id=? AND owner=?').bind(Date.now()+2500,retryAfter,error,provider,owner).run();
}
export const providerStatus=(provider:string)=>database().prepare('SELECT retry_after,last_error FROM market_providers WHERE id=?').bind(provider).first<{retry_after:number;last_error:string|null}>();

export async function enqueue(key:string,provider:string,ttl:number){
 await database().prepare('INSERT INTO market_refresh_queue(key,provider,requested_at,ttl) VALUES(?,?,?,?) ON CONFLICT(key) DO NOTHING').bind(key,provider,Date.now(),ttl).run();
}
export const nextJob=(provider:string)=>database().prepare('SELECT key,ttl FROM market_refresh_queue WHERE provider=? ORDER BY requested_at,key LIMIT 1').bind(provider).first<{key:string;ttl:number}>();
export const finishJob=(key:string)=>database().prepare('DELETE FROM market_refresh_queue WHERE key=?').bind(key).run();

export const setCooldown=(provider:string,until:number,message:string)=>database().prepare('INSERT INTO market_providers(id,owner,lease_until,retry_after,last_error) VALUES(?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET retry_after=MAX(market_providers.retry_after,excluded.retry_after),last_error=excluded.last_error').bind(provider,'cooldown',until,message).run();
