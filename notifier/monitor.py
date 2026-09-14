"""Local PULL monitor. No browser or hosted Site session is required."""
import base64
import ctypes
import json
import math
import re
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.error
from links import link_text

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'PULL-notifier'
CHAINS = ('solana', 'robinhood', 'bsc', 'base')
DEFAULT = dict(chains=['solana', 'robinhood', 'bsc'], threshold=75, min_tvl=10000,
               capital=200, horizon=1, interval=120, cooldown=21600, enabled=False)

def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATA / 'state.sqlite', timeout=10)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS pools (id TEXT PRIMARY KEY, streak INTEGER, armed INTEGER, sent REAL, seen REAL)')
    db.execute('CREATE TABLE IF NOT EXISTS impulse (id TEXT PRIMARY KEY, state TEXT NOT NULL, sent REAL NOT NULL DEFAULT 0)')
    db.execute('CREATE TABLE IF NOT EXISTS baseline (chain TEXT PRIMARY KEY)')
    db.execute('CREATE TABLE IF NOT EXISTS events (at REAL, kind TEXT, message TEXT)')
    db.commit()
    return db

def settings(db):
    row = db.execute('SELECT value FROM settings WHERE id=1').fetchone()
    return {**DEFAULT, **(json.loads(row[0]) if row else {})}

def save(db, config):
    db.execute('INSERT OR REPLACE INTO settings VALUES(1,?)', (json.dumps(config),))
    db.commit()

def event(db, kind, text):
    db.execute('INSERT INTO events VALUES(?,?,?)', (time.time(), kind, text[:600]))
    db.execute('DELETE FROM events WHERE at < ?', (time.time()-30*86400,))
    db.commit()

def protect(value, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('Хранение токена настроено для Windows')
    class Blob(ctypes.Structure):
        _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    raw = base64.b64decode(value) if decrypt else value.encode()
    buf = ctypes.create_string_buffer(raw)
    src = Blob(len(raw), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    out = Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(src), None, None, None, None, 1, ctypes.byref(out)):
        raise RuntimeError('Windows не смог обработать защищённый токен')
    try:
        result = ctypes.string_at(out.data, out.size)
        return result.decode() if decrypt else base64.b64encode(result).decode()
    finally:
        ctypes.windll.kernel32.LocalFree(out.data)

class ApiError(Exception):
    def __init__(self, status=0, retry=120):
        self.status, self.retry = status, min(3600, max(1, retry))
        super().__init__('Ошибка API' + (f' ({status})' if status else ': соединение не подтверждено'))

def request(url, payload=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
        headers={'User-Agent': 'PULL/1.0', 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        retry = 120
        try:
            retry = int(json.load(exc).get('parameters', {}).get('retry_after', 120))
        except Exception:
            pass
        raise ApiError(exc.code, retry) from None
    except Exception:
        # Never log exceptions containing Telegram's token-bearing URL.
        raise ApiError() from None
    if isinstance(data, dict) and data.get('ok') is False:
        raise ApiError(data.get('error_code', 0), data.get('parameters', {}).get('retry_after', 120))
    return data

def telegram(token, method, payload):
    return request('https://api.telegram.org/bot'+token+'/'+method, payload)['result']

def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None

def discover(chain):
    from gmgn_source import discover as fetch_combined
    return fetch_combined(chain)


def rate(pools, config):
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js не найден — требуется для общей модели оценки')
    result = subprocess.run([node, str(ROOT/'scripts/rate-pools.mjs')],
        input=json.dumps(dict(pools=pools, capital=config['capital'], horizon=config['horizon'], volumeStates=config.get('_volumeStates',{}), now=int(time.time()*1000))),
        capture_output=True, text=True, encoding='utf-8', timeout=30,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if result.returncode:
        raise RuntimeError('Не удалось рассчитать оценки; проверьте зависимости проекта')
    return json.loads(result.stdout)

PAIR_ASSETS = {'solana': {'SOL','WSOL'}, 'bsc': {'BNB','WBNB'}, 'base': {'ETH','WETH','USDC'}, 'robinhood': {'USDG'}}

def is_target_pair(pool):
    assets = PAIR_ASSETS.get(pool.get('chain'), set())
    return any(re.sub(r'\s+\d+(?:\.\d+)?%\s*$', '', str(pool.get(k, ''))).strip().upper() in assets for k in ('symbol','quote'))


def observe(db, pool, config, now, baseline=False):
    """Two consecutive successful observations; failures/absence break the streak."""
    row = db.execute('SELECT streak,armed,sent,seen FROM pools WHERE id=?', (pool['id'],)).fetchone()
    streak, armed, sent, seen = row or (0, 1, 0, 0)
    score = pool['rating']['score']
    qualifies = is_target_pair(pool) and score is not None and score >= config['threshold'] and (pool['liquidity'] or 0) >= config['min_tvl']
    if now-seen > config['interval']*2.5:
        streak = 0
    streak = streak+1 if qualifies else 0
    if score is not None and score < config['threshold']-10:
        armed = 1
    if baseline and qualifies:
        armed = 0
    db.execute('INSERT OR REPLACE INTO pools VALUES(?,?,?,?,?)', (pool['id'], streak, armed, sent, now))
    db.commit()
    return bool(qualifies and streak >= 2 and armed and now-sent >= config['cooldown'])

def message(pool, config):
    r = pool['rating']
    fee_text = str(pool['feePercent'])+'%' if pool.get('feePercent') is not None else 'н/д'
    if pool.get('dex')=='pons-v2-dex': fee_text += ' LP; hook-сборы отдельно'
    price_change = format(pool['change1'],'+.1f')+'%' if pool.get('change1') is not None else 'н/д'
    token_volume = '$'+format(pool['tokenV1'],',.0f') if pool.get('tokenV1') is not None else 'н/д'
    cap = '$'+format(pool['marketCap'],',.0f') if pool.get('marketCap') is not None else 'н/д'
    return (("РЕЗКИЙ РОСТ ОБЪЁМА\n" if pool.get('_spike') else "")+f"PULL · {pool['symbol']} / {pool['quote']} · {pool['chain']}\n"
        f"Оценка {r['score'] if r['score'] is not None else '—'}/100 · {r['regime']}\n"
        f"TVL ${pool['liquidity']:,.0f} · объём пула 1ч ${pool['v1']:,.0f}\n"
        f"Объём пула 5м ${pool['v5']:,.0f} · капитализация {cap}\n"
        f"Объём токена 1ч (GMGN): {token_volume}\n"
        f"Комиссия пула: {fee_text}\n"
        f"Цена 1ч {price_change} · профиль ${config['capital']:g} / {config['horizon']:g}ч\n"
        + ('Объём 5м ≥ $1 000 и ≥ 3× предыдущего среднего темпа 5м.\n' if pool.get('_spike') else 'Порог оценки подтверждён двумя проверками.\n')
        + ('; '.join(r['reasons'])+'\n' if r['reasons'] else '')
        + 'Предварительная оценка условий, не прогноз прибыли. Безопасность токена не проверена.\n'
        + link_text(pool)+'\nИсточник: '+pool['url'])

def cycle(db, config, token, fetch=discover, scorer=rate, sender=telegram):
    sent_count = 0
    for chain in config['chains']:
        if not settings(db)['enabled']:
            break
        try:
            volume_states = {pid:json.loads(state) for pid,state in db.execute('SELECT id,state FROM impulse WHERE id LIKE ?', (chain+':%',))}
            pools = scorer(fetch(chain), {**config,'_volumeStates':volume_states})
            now = time.time()
            first = db.execute('SELECT 1 FROM baseline WHERE chain=?', (chain,)).fetchone() is None
            ids = {p['id'] for p in pools}
            for (pid,) in db.execute('SELECT id FROM pools WHERE id LIKE ?', (chain+':%',)).fetchall():
                if pid not in ids:
                    db.execute('UPDATE pools SET streak=0 WHERE id=?', (pid,))
            candidates = []
            for p in pools:
                regular = observe(db,p,config,now,first)
                state = p.get('volumeSignal')
                spike = False
                if state:
                    row = db.execute('SELECT state,sent FROM impulse WHERE id=?',(p['id'],)).fetchone()
                    old = json.loads(row[0]) if row else None
                    last_sent = row[1] if row else 0
                    is_pair = is_target_pair(p)
                    spike = bool(not first and is_pair and (p.get('liquidity') or 0)>=config['min_tvl'] and state['kind']=='surge' and now-last_sent>=1800 and (not old or old.get('kind')!='surge' or last_sent==0))
                    # Initial scan establishes an episode without sending a burst of old spikes.
                    if first and state['kind']=='surge': last_sent=now
                    db.execute('INSERT OR REPLACE INTO impulse VALUES(?,?,?)',(p['id'],json.dumps(state),last_sent))
                    db.commit()
                p['_spike']=spike
                if regular or spike: candidates.append(p)
            if pools:
                db.execute('INSERT OR IGNORE INTO baseline VALUES(?)', (chain,))
            db.commit()
            for p in sorted(candidates, key=lambda p: (bool(p.get('_spike')),p['rating']['score'] or 0), reverse=True):
                if sent_count >= 5 or not settings(db)['enabled']:
                    break
                if p.get('discoverySource')=='GMGN':
                    try:
                        from gmgn_source import fee
                        p['feePercent']=fee(p)
                    except RuntimeError: pass
                # Reserve before sending. If the process dies or Telegram times out,
                # don't repeat an ambiguously delivered notification on restart.
                if p.get('_spike'): db.execute('UPDATE impulse SET sent=? WHERE id=?',(now,p['id']))
                db.execute('UPDATE pools SET armed=0,sent=? WHERE id=?', (now, p['id']))
                db.commit()
                try:
                    sender(token, 'sendMessage', dict(chat_id=config['chat_id'], text=message(p, config), link_preview_options={'is_disabled': True}))
                    event(db, 'sent', p['id']+' · '+str(p['rating']['score']))
                    sent_count += 1
                    time.sleep(1)
                except ApiError as exc:
                    if 400 <= exc.status < 500:
                        if p.get('_spike'): db.execute('UPDATE impulse SET sent=0 WHERE id=?',(p['id'],))
                        db.execute('UPDATE pools SET armed=1,sent=0 WHERE id=?', (p['id'],))
                        db.commit()
                    event(db, 'error', 'Telegram: '+str(exc)+'; при неопределённом результате повтор отключён')
                    if exc.status in (400, 401, 403):
                        latest = settings(db); latest['enabled'] = False; save(db, latest)
                    return max(config['interval'], exc.retry)
            event(db, 'scan', chain+': '+str(len(pools))+' пулов'+(' · начальная выборка без рассылки' if first else ''))
        except Exception as exc:
            db.execute('UPDATE pools SET streak=0 WHERE id LIKE ?', (chain+':%',))
            db.commit()
            event(db, 'error', chain+': '+(str(exc) if isinstance(exc, (ApiError, RuntimeError)) else 'Ошибка обработки данных'))
    return config['interval']

def run():
    # OS releases the file lock after a crash. Two workers cannot send in parallel.
    DATA.mkdir(parents=True, exist_ok=True)
    lock = open(DATA/'worker.lock', 'a+b')
    if os.name=='nt':
        import msvcrt
        lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return
    db = connect()
    while True:
        config = settings(db)
        if not config['enabled']:
            return
        try:
            token = protect(config['token'], True)
            delay = cycle(db, config, token)
        except Exception:
            event(db, 'error', 'Не удалось прочитать настройки или токен. Откройте настройки уведомлений.')
            return
        for _ in range(int(delay)):
            time.sleep(1)
            if not settings(db)['enabled']:
                return

if __name__ == '__main__':
    run()
