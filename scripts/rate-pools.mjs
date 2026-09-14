import ts from 'typescript';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const js=ts.transpileModule(readFileSync(new URL('../lib/engine.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};vm.runInNewContext(js,{exports,Date,Math,Map,Set,Number,Intl});
let input='';for await(const chunk of process.stdin)input+=chunk;
const {pools,capital,horizon,now,volumeStates={}}=JSON.parse(input);
process.stdout.write(JSON.stringify(pools.map(p=>({...p,rating:exports.evaluate(p,capital,horizon,now),volumeSignal:exports.volumeImpulse(p,volumeStates[p.id],now)}))));
