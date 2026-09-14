"""Loopback-only, read-only public market data for the PULL browser and notifier."""
import json,os,re,time,math,threading,urllib.request,urllib.parse
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from gmgn_source import discover_direct
from monitor import ROOT,DATA,CHAINS,DEFAULT,is_target_pair,rate

PORT=18767
ORIGIN='https://pull-liquidity-radar.kurmanbaevd10.chatgpt.site'
CACHE=DATA/'market-cache.json'
STATE={'heartbeat':0,'chains':{}}
LOCK=threading.RLock()
CHARTS={}
def read_state():
    try:return json.loads(CACHE.read_text(encoding='utf-8'))
    except (OSError,ValueError):return {'heartbeat':0,'chains':{}}
def save():
    DATA.mkdir(parents=True,exist_ok=True)
    STATE['heartbeat']=time.time()
    tmp=CACHE.with_suffix('.tmp')
    tmp.write_text(json.dumps(STATE,ensure_ascii=False),encoding='utf-8');os.replace(tmp,CACHE)

def valid_address(value,chain):
    return bool(re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}' if chain=='solana' else r'0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})',value))
def fee_metadata(chain,pools,previous):
    by_id={p['id']:p for p in previous}
    for p in pools:
        old=by_id.get(p['id'],{})
        for k in ['feePercent','feeSource','feeNote','feeCheckedAt','lpDex']:
            if k in old:p[k]=old[k]
    due=sorted([p for p in pools if is_target_pair(p) and time.time()*1000-p.get('feeCheckedAt',0)>3600000],key=lambda p:p.get('liquidity') or 0,reverse=True)[:20]
    if not due:return
    try:
        url='https://api.geckoterminal.com/api/v2/networks/'+chain+'/pools/multi/'+','.join(p['address'] for p in due)
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'PULL/1.0'}),timeout=8) as r:data=json.load(r)
        rows={x.get('id'):x for x in data.get('data',[])}
        for p in due:
            x=rows.get(chain+'_'+p['address'])
            if not x:continue
            match=re.search(r'\s(\d+(?:\.\d+)?)%\s*$',x.get('attributes',{}).get('name',''))
            p.update(feePercent=float(match[1]) if match else None,feeSource='GeckoTerminal · метаданные пула',feeCheckedAt=int(time.time()*1000),lpDex=x.get('relationships',{}).get('dex',{}).get('data',{}).get('id',p['dex']))
    except Exception:pass

def collect_once():
    for chain in CHAINS:
        with LOCK:
            old=STATE['chains'].get(chain,{});previous=old.get('pools',[]);save()
        try:
            pools=discover_direct(chain)
            volume_states={p['id']:p['volumeSignal'] for p in previous if p.get('volumeSignal')}
            pools=rate(pools,{**DEFAULT,'_volumeStates':volume_states})
            for p in pools:p.pop('rating',None)
            fee_metadata(chain,pools,previous)
            entry={'pools':pools,'observedAt':int(time.time()*1000),'error':None}
        except Exception as exc:
            entry={**old,'error':str(exc) if isinstance(exc,RuntimeError) else 'Не удалось обновить источник'}
        with LOCK:STATE['chains'][chain]=entry;save()
        time.sleep(2)
def loop():
    while True:
        collect_once()
        for _ in range(8):
            time.sleep(15)
            with LOCK:save()

def pools_response(query,state):
    chain=query.get('chain',['solana'])[0]
    if chain!='all' and chain not in CHAINS:raise ValueError('Неизвестная сеть')
    networks=CHAINS if chain=='all' else (chain,)
    token=query.get('token',[''])[0];ids=query.get('ids',[''])[0].split(',') if query.get('ids') else []
    if token and (chain=='all' or not valid_address(token,chain)):raise ValueError('Неверный адрес токена')
    if ids and (chain=='all' or len(ids)>10 or any(not valid_address(a,chain) for a in ids)):raise ValueError('Неверные адреса пулов')
    key=lambda a:a if chain=='solana' else a.lower()
    rows=[];errors=[]
    for c in networks:
        entry=state.get('chains',{}).get(c,{})
        if entry.get('error'):errors.append({'chain':c,'message':entry['error']})
        elif not entry.get('pools'):errors.append({'chain':c,'message':'Первая локальная выборка ещё готовится'})
        rows.extend(entry.get('pools',[]))
    if token:rows=[p for p in rows if key(p['token'])==key(token)]
    if ids:rows=[p for p in rows if key(p['address']) in {key(a) for a in ids}]
    if query.get('feed',[''])[0]=='new':rows=[p for p in rows if p.get('createdAt') and time.time()*1000-p['createdAt']<=86400000]
    rows=[p for p in rows if is_target_pair(p)]
    if token and not rows:errors.append({'chain':chain,'message':'Токен пока отсутствует в локальной выборке кандидатов'})
    return {'pools':rows,'errors':errors,'coverage':'Ваш компьютер · GMGN + DEX Screener · сбор каждые 2–3 мин','fetchedAt':int(time.time()*1000)}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def allowed(self):
        return self.headers.get('Host') in (f'127.0.0.1:{PORT}',f'localhost:{PORT}') and self.headers.get('Origin')==ORIGIN
    def reply(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        if self.allowed():
            self.send_header('Access-Control-Allow-Origin',ORIGIN)
            self.send_header('Access-Control-Allow-Private-Network','true')
            self.send_header('Access-Control-Allow-Methods','GET, OPTIONS')
        self.send_header('Vary','Origin');self.send_header('Cache-Control','no-store')
        self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)))
        self.end_headers();self.wfile.write(raw)
    def do_OPTIONS(self):
        self.reply(200 if self.allowed() else 403,{})
    def do_GET(self):
        if not self.allowed():return self.reply(403,{'error':'Origin or Host not allowed'})
        parsed=urllib.parse.urlparse(self.path);q=urllib.parse.parse_qs(parsed.query)
        try:
            with LOCK:state=json.loads(json.dumps(STATE))
            if parsed.path=='/health':
                return self.reply(200,{'service':'PULL-local','version':1,'heartbeat':state['heartbeat']})
            if parsed.path=='/api/pools':return self.reply(200,pools_response(q,state))
            if parsed.path=='/api/pool-fee':
                chain=q.get('chain',[''])[0];address=q.get('pool',[''])[0]
                rows=state.get('chains',{}).get(chain,{}).get('pools',[])
                p=next((p for p in rows if p['address']==address or chain!='solana' and p['address'].lower()==address.lower()),{})
                return self.reply(200,{k:p.get(k) for k in ['feePercent','feeSource','feeNote','feeCheckedAt']})
            if parsed.path=='/api/history':
                chain=q.get('chain',[''])[0];pool=q.get('pool',[''])[0];token=q.get('token',[''])[0]
                if chain not in CHAINS or not valid_address(pool,chain) or not valid_address(token,chain):raise ValueError('Неверные адреса графика')
                key=(chain,pool,token);cached=CHARTS.get(key)
                if cached and time.time()-cached[0]<300:return self.reply(200,cached[1])
                url='https://api.geckoterminal.com/api/v2/networks/'+chain+'/pools/'+pool+'/ohlcv/minute?'+urllib.parse.urlencode(dict(aggregate=5,limit=100,currency='usd',token=token))
                with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'PULL/1.0'}),timeout=8) as r:d=json.load(r)
                same=lambda a:a if chain=='solana' else a.lower()
                if not any(same((d.get('meta',{}).get(side) or {}).get('address',''))==same(token) for side in ['base','quote']):raise ValueError('Источник не подтвердил токен графика')
                data={'candles':[c for c in d.get('data',{}).get('attributes',{}).get('ohlcv_list',[]) if isinstance(c,list) and len(c)==6 and all(isinstance(v,(int,float)) and math.isfinite(v) for v in c) and c[0]+300<=time.time()],'source':'GeckoTerminal','fetchedAt':int(time.time()*1000)}
                CHARTS[key]=(time.time(),data);return self.reply(200,data)
            self.reply(404,{'error':'Not found'})
        except ValueError as e:self.reply(400,{'error':str(e)})
        except Exception:self.reply(502,{'error':'Локальный источник временно недоступен'})
    def do_POST(self):self.reply(405,{'error':'Read only'})

def run():
    server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    with LOCK:STATE.update(read_state());save()
    threading.Thread(target=loop,daemon=True).start()
    server.serve_forever()
if __name__=='__main__':run()
