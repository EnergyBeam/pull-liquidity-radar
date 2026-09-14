"""Public market data only. API key never enters output, request URLs or Node input."""
import json,os,shutil,subprocess,time,uuid,urllib.request,urllib.parse,urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class MarketError(RuntimeError): pass
_cooldown=0

def api_key():
    key=os.environ.get('GMGN_API_KEY','')
    if not key:
        path=ROOT.parent/'gmgn-credentials'/'gmgn-api.env'
        if path.exists():
            key=next((s.split('=',1)[1].strip().strip("\"'") for s in path.read_text(encoding='utf-8-sig').splitlines() if s.startswith('GMGN_API_KEY=')),'')
    if not key: raise MarketError('GMGN: API-ключ не подключён')
    return key

def get(provider,path,params=None):
    global _cooldown
    if time.time()<_cooldown: raise MarketError('Пауза источника до следующего цикла')
    params=dict(params or {})
    headers={'User-Agent':'PULL/1.0','Accept':'application/json'}
    if provider=='gmgn':
        headers['X-APIKEY']=api_key();params.update(timestamp=int(time.time()),client_id=str(uuid.uuid4()))
    url=('https://openapi.gmgn.ai' if provider=='gmgn' else 'https://api.dexscreener.com')+path
    if params: url+='?'+urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=8) as r: data=json.load(r)
    except urllib.error.HTTPError as e:
        if e.code==429:
            try: reset=float(e.headers.get('x-ratelimit-reset','0'))
            except ValueError: reset=0
            _cooldown=max(time.time()+120,reset)
        raise MarketError(provider+': ошибка источника ('+str(e.code)+')') from None
    except Exception: raise MarketError(provider+': соединение не подтверждено') from None
    if provider=='gmgn':
        for _ in range(2):
            if not isinstance(data,dict) or 'code' not in data: break
            if data['code']!=0: raise MarketError('GMGN: запрос отклонён')
            data=data.get('data')
    return data

def discover_direct(chain):
    g='sol' if chain=='solana' else chain
    hour=get('gmgn','/v1/market/rank',dict(chain=g,interval='1h',limit=20,order_by='volume',direction='desc')).get('rank',[])
    time.sleep(1.1)
    five=get('gmgn','/v1/market/rank',dict(chain=g,interval='5m',limit=20,order_by='volume',direction='desc')).get('rank',[])
    token_at=int(time.time()*1000);tokens={}
    for i in range(20):
        for rows in [hour,five]:
            if i<len(rows) and rows[i].get('address'): tokens.setdefault(rows[i]['address'],rows[i])
            if len(tokens)>=20: break
        if len(tokens)>=20: break
    def pairs_for(address):
        pairs=get('dex','/token-pairs/v1/'+chain+'/'+address)
        if not isinstance(pairs,list): raise MarketError('DEX Screener: неверный ответ')
        return pairs
    with ThreadPoolExecutor(max_workers=4) as executor:
        pairs=[p for group in executor.map(pairs_for,tokens) for p in group]
    node=shutil.which('node')
    if not node: raise MarketError('Node.js не найден')
    result=subprocess.run([node,str(ROOT/'scripts/normalize-market.mjs')],input=json.dumps(dict(chain=chain,hour=hour,five=five,pairs=pairs,at=int(time.time()*1000),tokenAt=token_at)),capture_output=True,text=True,encoding='utf-8',timeout=10,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if result.returncode: raise MarketError('Не удалось сопоставить токены и пулы')
    return json.loads(result.stdout)

def fee(pool):
    data=get('gmgn','/v1/token/pool_info',dict(chain='sol' if pool['chain']=='solana' else pool['chain'],address=pool['token']))
    same=(lambda a:a if pool['chain']=='solana' else a.lower())
    if same(str(data.get('pool_address','')))!=same(pool['address']): return None
    try:
        value=float(data['fee_ratio'])
        return value if 0<=value<=100 else None
    except (KeyError,TypeError,ValueError): return None


def discover(chain):
    # Share the collector's observations instead of duplicating provider requests.
    cache=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'PULL-notifier'/'market-cache.json'
    try:
        data=json.loads(cache.read_text(encoding='utf-8'))
        if time.time()-data.get('heartbeat',0)<300:
            entry=data.get('chains',{}).get(chain,{})
            if entry.get('error') or not entry.get('pools') or time.time()*1000-entry.get('observedAt',0)>600000:
                raise MarketError(entry.get('error') or 'Локальная выборка ещё готовится')
            return entry['pools']
    except (OSError,ValueError): pass
    return discover_direct(chain)
