import protocols from './dex-protocols.json';
import known from './krystal-links.json';

// Route and protocol names verified against original Krystal pool links.
// Unknown DEX versions must not be guessed from token names or address length.
export function krystalPoolUrl(chain:string,address:string,dex=''):string|null{
 const chainId=({robinhood:4663,base:8453,bsc:56} as Record<string,number>)[chain];
 if(!chainId||!/^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(address))return null;
 const original=(known as Record<string,string>)[chain+':'+address.toLowerCase()];
 if(original)return original;
 const normalized=chain==='robinhood'&&dex.toLowerCase().trim()==='pons-v2-dex'?'uniswapv4':dex.toLowerCase().trim();
 const key=normalized.replace(/[-_](?:robinhood|base|bsc)$/,'').replace(/[-_\s]/g,'');
 const protocol=(protocols as Record<string,string>)[key];
 if(!protocol)return null;
 if(address.length!==(protocol==='uniswapv4'?66:42))return null;
 return 'https://defi.krystal.app/pools/detail?'+new URLSearchParams({chainId:String(chainId),poolAddress:address,protocol});
}


export function meteoraPoolUrl(address:string,dex=''):string|null{
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return null;
 const route=({'meteora':'dlmm','meteora-dlmm':'dlmm','meteora-damm-v2':'dammv2','meteora-dammv2':'dammv2','meteora-pools':'pools'} as Record<string,string>)[dex.toLowerCase().trim()];
 return route?'https://app.meteora.ag/'+route+'/'+address:null;
}
export function poolAppLink(chain:string,address:string,dex=''){
 return chain==='solana'?{label:'Meteora',url:meteoraPoolUrl(address,dex)}:{label:'Krystal',url:krystalPoolUrl(chain,address,dex)};
}
