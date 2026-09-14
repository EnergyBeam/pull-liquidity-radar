'use client';
import {useEffect,useRef} from 'react';
type Snapshot={mode:string;pools:{id:string;symbol:string;chain:string;score:number|null;regime:string}[]};
type Tool={name:string;title:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown};
type Context={registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>};
export function useTrackerTools(snapshot:Snapshot,configure:(capital:number,hours:number)=>void){
 const ref=useRef({snapshot,configure});useEffect(()=>{ref.current={snapshot,configure};},[snapshot,configure]);
 useEffect(()=>{
  const ctx=(document as Document&{modelContext?:Context}).modelContext;
  if(!ctx?.registerTool)return;
  const lifecycle=new AbortController();
  const tools:Tool[]=[
   {name:'read_pool_candidates',title:'Прочитать кандидатов',description:'Получить текущие видимые пулы и оценки условий. Рыночные данные могут быть неполными.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>ref.current.snapshot},
   {name:'configure_lp_profile',title:'Настроить LP-позицию',description:'Изменить капитал и горизонт оценки в текущем интерфейсе.',inputSchema:{type:'object',properties:{capital:{type:'number',minimum:1,maximum:1000000},hours:{type:'number',enum:[.25,1,4]}},required:['capital','hours'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async input=>{const p=input as {capital:number;hours:number};if(!p||!Number.isFinite(p.capital)||p.capital<1||p.capital>1000000||![.25,1,4].includes(p.hours))throw new Error('Некорректный профиль');ref.current.configure(p.capital,p.hours);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {capital:p.capital,hours:p.hours};}}
  ];
  for(const tool of tools)try{void Promise.resolve(ctx.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
  return()=>lifecycle.abort();
 },[]);
}


