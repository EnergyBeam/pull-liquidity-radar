"""Links use token contracts for GMGN and pool addresses for LP applications."""
import json
import re
from pathlib import Path
from urllib.parse import urlencode

PROTOCOLS = json.loads((Path(__file__).resolve().parents[1]/'lib/dex-protocols.json').read_text(encoding='utf-8'))
KNOWN = json.loads((Path(__file__).resolve().parents[1]/'lib/krystal-links.json').read_text(encoding='utf-8'))

def links(pool):
    chain, token, address, dex = (pool.get(k, '') for k in ('chain','token','address','dex'))
    dex=(pool.get('lpDex') or dex).lower().strip()
    gmgn_chain = {'solana':'sol','robinhood':'robinhood','bsc':'bsc','base':'base'}.get(chain)
    valid_token = bool(re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}' if chain=='solana' else r'0x[0-9a-fA-F]{40}', token))
    gmgn = f'https://gmgn.ai/{gmgn_chain}/token/{token}' if gmgn_chain and valid_token else None
    lp = None
    label = 'Meteora' if chain=='solana' else 'Krystal'
    if chain=='solana' and re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}',address):
        route = {'meteora':'dlmm','meteora-dlmm':'dlmm','meteora-damm-v2':'dammv2','meteora-dammv2':'dammv2','meteora-pools':'pools'}.get(dex)
        if route:
            lp = f'https://app.meteora.ag/{route}/{address}'
    elif chain in ('robinhood','bsc','base') and re.fullmatch(r'0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})',address):
        lp = KNOWN.get(chain+':'+address.lower())
        if chain=='robinhood' and dex=='pons-v2-dex': dex='uniswapv4'
        key=re.sub(r'[-_\s]','',re.sub(r'[-_](robinhood|base|bsc)$','',dex))
        protocol=PROTOCOLS.get(key)
        if not lp and protocol and len(address)==(66 if protocol=='uniswapv4' else 42):
            lp = 'https://defi.krystal.app/pools/detail?'+urlencode(dict(chainId={'robinhood':4663,'bsc':56,'base':8453}[chain],poolAddress=address,protocol=protocol))

    return gmgn, label, lp

def link_text(pool):
    gmgn,label,lp = links(pool)
    return '\n'.join([('GMGN: '+gmgn) if gmgn else 'GMGN: адрес токена не определён',
                      (label+': '+lp) if lp else label+': прямая ссылка для этого протокола не определена'])
