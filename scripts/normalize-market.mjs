import {normalizePools} from '../lib/combined-market.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {chain,hour,five,pairs,at,tokenAt}=JSON.parse(input);
process.stdout.write(JSON.stringify(normalizePools(chain,hour,five,pairs,at,tokenAt)));
