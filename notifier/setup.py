"""Interactive Windows setup: token never enters the browser or terminal output."""
import json
import re
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path
from monitor import connect, settings, save, protect, telegram, event, CHAINS, DATA

def main():
    root = tk.Tk()
    root.title('PULL — Telegram-уведомления')
    root.geometry('740x770')
    root.minsize(650, 650)
    root.configure(bg='#101820')
    style = ttk.Style(root)
    style.theme_use('clam')
    style.configure('.', font=('Segoe UI', 11))
    db = connect(); initial = settings(db); db.close()
    panel = ttk.Frame(root, padding=22); panel.pack(fill='both', expand=True)
    ttk.Label(panel, text='PULL · уведомления в Telegram', font=('Segoe UI', 19, 'bold')).pack(anchor='w')
    ttk.Label(panel, text='Работает при включённом компьютере. Сайт можно закрыть.').pack(anchor='w', pady=(4,16))
    token = tk.StringVar()
    status = tk.StringVar(value='Бот ещё не подключён' if not initial.get('chat_id') else 'Сохранено подключение к личному чату')
    ttk.Label(panel, text='Токен бота от @BotFather (пустое поле сохраняет прежний)').pack(anchor='w')
    ttk.Entry(panel, textvariable=token, show='•').pack(fill='x', pady=6)
    ttk.Label(panel, text='Токен хранится зашифрованным Windows только на этом компьютере.').pack(anchor='w')
    binding = {'code': '', 'created': 0, 'token': ''}
    command = tk.StringVar(value='1. Введите токен и нажмите «Подготовить подключение».')
    ttk.Label(panel, textvariable=command, wraplength=670).pack(anchor='w', pady=12)

    def async_job(job):
        def task():
            try:
                result = job()
                root.after(0, lambda: status.set(result))
            except Exception as exc:
                # API errors are sanitized by monitor.request.
                text = str(exc) if isinstance(exc, RuntimeError) else 'Не удалось выполнить запрос. Проверьте токен, сеть и журнал.'
                root.after(0, lambda: status.set(text))
        threading.Thread(target=task, daemon=True).start()

    def saved_token():
        text = token.get().strip()
        if text:
            if not re.fullmatch(r'\d{5,}:[A-Za-z0-9_-]{20,}', text):
                raise RuntimeError('Токен имеет неверный формат')
            return text
        db = connect(); cfg = settings(db); db.close()
        if not cfg.get('token'):
            raise RuntimeError('Введите токен от @BotFather')
        return protect(cfg['token'], True)

    def prepare():
        try:
            candidate = saved_token()
        except RuntimeError as exc:
            status.set(str(exc)); return
        def job():
            me = telegram(candidate, 'getMe', {})
            hook = telegram(candidate, 'getWebhookInfo', {})
            if hook.get('url'):
                raise RuntimeError('Этот бот занят webhook-интеграцией. Используйте отдельного бота; текущий webhook не изменён.')
            import secrets
            code = 'pull_'+secrets.token_hex(8)
            binding.update(code=code, created=time.time(), token=candidate)
            root.after(0, lambda: command.set('2. Отправьте боту @'+me['username']+' в личном чате: /start '+code+'\nЗатем нажмите «Подтвердить чат».'))
            return 'Бот проверен. Ожидается ваше сообщение с кодом.'
        async_job(job)

    def confirm():
        if not binding['code']:
            status.set('Сначала подготовьте подключение'); return
        def job():
            updates = telegram(binding['token'], 'getUpdates', {'timeout': 0, 'limit': 100})
            matches = [u.get('message', {}) for u in updates]
            matches = [m for m in matches if m.get('chat', {}).get('type')=='private'
                and m.get('text')=='/start '+binding['code'] and m.get('date',0)>=binding['created']-2]
            if not matches:
                raise RuntimeError('Сообщение с кодом не найдено. Отправьте команду в личный чат с ботом и повторите.')
            if len({m['chat']['id'] for m in matches}) != 1:
                raise RuntimeError('Код пришёл из разных чатов. Подготовьте новый код.')
            db = connect(); cfg = settings(db)
            cfg.update(token=protect(binding['token']), chat_id=str(matches[0]['chat']['id']), enabled=False)
            save(db, cfg); event(db, 'setup', 'Личный чат подтверждён'); db.close()
            binding.update(code='', token='')
            root.after(0, lambda: token.set(''))
            return 'Чат подключён. Можно отправить тест и включить мониторинг.'
        async_job(job)

    row = ttk.Frame(panel); row.pack(fill='x', pady=5)
    ttk.Button(row, text='Подготовить подключение', command=prepare).pack(side='left')
    def copy_code():
        if binding['code']:
            root.clipboard_clear(); root.clipboard_append('/start '+binding['code'])
    ttk.Button(row, text='Скопировать команду', command=copy_code).pack(side='left', padx=6)
    ttk.Button(row, text='Подтвердить чат', command=confirm).pack(side='left')
    ttk.Separator(panel).pack(fill='x', pady=15)
    chain_vars = {c: tk.BooleanVar(value=c in initial['chains']) for c in CHAINS}
    row = ttk.Frame(panel); row.pack(fill='x')
    for c, v in chain_vars.items():
        ttk.Checkbutton(row, text=c, variable=v).pack(side='left', padx=(0,12))
    fields = {}
    grid = ttk.Frame(panel); grid.pack(fill='x', pady=10)
    for index, (key, label) in enumerate([('threshold','Оценка от (50–100)'), ('min_tvl','TVL от, $'), ('capital','Позиция, $'), ('horizon','Горизонт, ч: 0.25 / 1 / 4')]):
        ttk.Label(grid, text=label).grid(row=index//2, column=(index%2)*2, sticky='w', padx=(0,8), pady=5)
        v = tk.StringVar(value=str(initial[key])); fields[key] = v
        ttk.Entry(grid, textvariable=v, width=10).grid(row=index//2, column=(index%2)*2+1, padx=(0,14))
    ttk.Label(panel, text='Solana: SOL/WSOL · BSC: BNB/WBNB · Base: ETH/WETH/USDC · Robinhood: USDG\nПроверка каждые 2 минуты · два подтверждения · до 5 сообщений за цикл\nПовтор — после снижения оценки на 10 пунктов и паузы 6 часов.\nПервая выборка запоминается без рассылки. Кандидаты — GMGN, показатели пулов — DEX Screener. Это выборка, не весь рынок.', wraplength=670).pack(anchor='w', pady=8)

    def start():
        try:
            values = {k:float(v.get()) for k,v in fields.items()}
            chosen = [c for c,v in chain_vars.items() if v.get()]
            import math
            if not chosen or not all(math.isfinite(v) for v in values.values()) or not 50<=values['threshold']<=100 or not 0<=values['min_tvl']<=1e12 or not 1<=values['capital']<=1e6 or values['horizon'] not in (.25,1,4):
                raise ValueError()
            db = connect(); cfg = settings(db)
            if not cfg.get('token') or not cfg.get('chat_id'):
                db.close(); status.set('Сначала подтвердите личный чат'); return
            cfg.update(values, chains=chosen, enabled=True); save(db,cfg); db.close()
            exe = Path(sys.executable).with_name('pythonw.exe')
            subprocess.Popen([str(exe), str(Path(__file__).with_name('monitor.py'))], cwd=str(Path(__file__).parent),
                creationflags=subprocess.CREATE_NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            status.set('Мониторинг включён. Это окно можно закрыть; после перезагрузки включите снова.')
        except ValueError:
            status.set('Проверьте сети и числовые параметры')
        except Exception:
            status.set('Не удалось запустить мониторинг')

    def stop():
        db = connect(); cfg=settings(db); cfg['enabled']=False; save(db,cfg); db.close()
        status.set('Остановлено. Уже выполняющийся запрос Telegram может завершиться.')

    def test():
        def job():
            db=connect(); cfg=settings(db); db.close()
            if not cfg.get('chat_id'):
                raise RuntimeError('Сначала подтвердите чат')
            telegram(protect(cfg['token'],True), 'sendMessage', {'chat_id':cfg['chat_id'], 'text':'PULL: тестовое уведомление. Бот подключён к вашему локальному монитору.'})
            return 'Тестовое сообщение отправлено в подтверждённый чат'
        async_job(job)
    row=ttk.Frame(panel); row.pack(fill='x', pady=8)
    ttk.Button(row, text='Отправить тест', command=test).pack(side='left')
    ttk.Button(row, text='Сохранить и включить', command=start).pack(side='left', padx=8)
    ttk.Button(row, text='Остановить', command=stop).pack(side='left')
    ttk.Label(panel, textvariable=status, wraplength=670, foreground='#086549').pack(anchor='w', pady=10)
    log=tk.Text(panel, height=7, state='disabled', font=('Consolas',9)); log.pack(fill='both', expand=True)
    def refresh():
        db=connect(); rows=db.execute('SELECT at,kind,message FROM events ORDER BY at DESC LIMIT 8').fetchall(); db.close()
        log.configure(state='normal'); log.delete('1.0','end')
        log.insert('end','\n'.join(time.strftime('%H:%M:%S',time.localtime(t))+' '+k+' '+m for t,k,m in rows))
        log.configure(state='disabled'); root.after(3000,refresh)
    refresh(); root.mainloop()

if __name__=='__main__':
    main()
