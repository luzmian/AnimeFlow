"""Local user data. Atomic per-item writes, portable on Windows/Linux."""
import json, math, os, sqlite3, time, threading
from datetime import date
_INIT_LOCK=threading.Lock()
_INITIALIZED=set()
from pathlib import Path
from contextlib import contextmanager

def data_dir():
    if os.environ.get('ANIMEFLOW_DATA_DIR'): return Path(os.environ['ANIMEFLOW_DATA_DIR'])
    if os.name=='nt' and os.environ.get('LOCALAPPDATA'): return Path(os.environ['LOCALAPPDATA'])/'AnimeFlow'
    return Path(__file__).resolve().parent/'data'

@contextmanager
def connect():
    folder=data_dir();folder.mkdir(parents=True,exist_ok=True)
    path=folder/'user.sqlite3'
    with _INIT_LOCK:
        existed=path.exists();c=sqlite3.connect(path,timeout=15)
        c.execute('PRAGMA busy_timeout=15000')
        if str(path) not in _INITIALIZED or not existed:
            c.execute('PRAGMA journal_mode=WAL')
            c.executescript("""
            CREATE TABLE IF NOT EXISTS follows(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS history(key TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reads(key TEXT PRIMARY KEY, at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS remote_cache(key TEXT PRIMARY KEY, body TEXT NOT NULL, at REAL NOT NULL);
            """)
            _INITIALIZED.add(str(path))
    try:
        with c:yield c
    finally:c.close()

def anime(a):
    if not isinstance(a,dict) or not isinstance(a.get('id'),int) or a['id']<=0: raise ValueError('动漫资料无效')
    if len(json.dumps(a))>500_000: raise ValueError('动漫资料过大')
    return a

def progress(h):
    if not isinstance(h,dict): raise ValueError('进度无效')
    anime(h.get('anime'))
    ep=h.get('episode');seconds=h.get('seconds')
    if isinstance(ep,bool) or not isinstance(ep,(int,float)) or not math.isfinite(ep) or ep<=0: raise ValueError('集数无效')
    if isinstance(seconds,bool) or not isinstance(seconds,(int,float)) or not math.isfinite(seconds) or not 0<=seconds<=86400: raise ValueError('进度无效')
    if 'page_offset' in h and (isinstance(h['page_offset'],bool) or not isinstance(h['page_offset'],int) or not 0<=h['page_offset']<=30000):raise ValueError('剧集分页位置无效')
    if 'captured_at' in h and (isinstance(h['captured_at'],bool) or not isinstance(h['captured_at'],int) or not 0<=h['captured_at']<=int(time.time()*1000)+120000):raise ValueError('进度记录时间无效')
    if 'source' in h:
        if h['source'] not in ('manual','local-file'):raise ValueError('播放来源无效')
        if h['source']=='local-file':
            media=h.get('media');duration=h.get('duration')
            if not isinstance(duration,(int,float)) or isinstance(duration,bool) or not math.isfinite(duration) or not 0<duration<=86400 or seconds>duration+.5:raise ValueError('视频时长无效')
            if not isinstance(media,dict) or set(media)!={'name','size','last_modified'}:raise ValueError('文件标识无效')
            if not isinstance(media['name'],str) or not 0<len(media['name'])<=1024:raise ValueError('文件名无效')
            for key in ('size','last_modified'):
                if isinstance(media[key],bool) or not isinstance(media[key],int) or not 0<=media[key]<=2**53-1:raise ValueError('文件标识无效')
    return h

def snapshot():
    with connect() as c:
        return {'follows':{str(k):json.loads(b) for k,b in c.execute('SELECT id,body FROM follows')},
                'history':{k:json.loads(b) for k,b in c.execute('SELECT key,body FROM history')},
                'reads':{k:at for k,at in c.execute('SELECT key,at FROM reads')},
                'settings':{k:json.loads(b) for k,b in c.execute('SELECT key,body FROM settings')}}

def mutate(d):
    if not isinstance(d,dict): raise ValueError('请求无效')
    op=d.get('op')
    with connect() as c:
        if op=='follow':
            a=anime(d.get('anime'));c.execute('INSERT OR REPLACE INTO follows VALUES (?,?)',(a['id'],json.dumps(a,ensure_ascii=False)))
        elif op=='unfollow': c.execute('DELETE FROM follows WHERE id=?',(int(d['id']),))
        elif op=='progress':
            h=progress(d.get('record'));h=dict(h,at=int(time.time()*1000));key=f"{h['anime']['id']}:{h['episode']:g}"
            # A page-close beacon may overtake an in-flight periodic save. Preserve
            # the newer capture, including intentional backward seeks.
            h.setdefault('captured_at',h['at'])
            c.execute('BEGIN IMMEDIATE')
            existing=c.execute('SELECT body FROM history WHERE key=?',(key,)).fetchone()
            previous=json.loads(existing[0]) if existing else None
            if not previous or h['captured_at']>=previous.get('captured_at',previous.get('at',0)):
                c.execute('INSERT OR REPLACE INTO history VALUES (?,?)',(key,json.dumps(h,ensure_ascii=False)))
        elif op=='delete_history': c.execute('DELETE FROM history WHERE key=?',(str(d['key']),))
        elif op=='read':
            keys=d.get('keys')
            if not isinstance(keys,list) or len(keys)>2000 or any(not isinstance(k,str) or len(k)>100 for k in keys):raise ValueError('记录键无效')
            c.executemany('INSERT OR REPLACE INTO reads VALUES (?,?)',[(k,int(time.time()*1000)) for k in keys])
        elif op=='setting':
            key,value=d.get('key'),d.get('value')
            valid=(key=='dark' and isinstance(value,bool)) or (key=='ui_tab' and value in ('library','feed','history')) or (key=='ui_feed_mode' and value in ('all','mine'))
            if key=='player_danmaku':
                valid=isinstance(value,dict) and set(value)=={'enabled','opacity','font','speed','area'} and isinstance(value['enabled'],bool)
                if valid:
                    valid=all(not isinstance(value[k],bool) and isinstance(value[k],(int,float)) and math.isfinite(value[k]) for k in ('opacity','font','speed','area')) and .1<=value['opacity']<=1 and value['font'] in (18,24,30,36) and value['speed'] in (5,8,12) and value['area'] in (.25,.5,.75,1)
            if key in ('update_baseline_all','update_baseline_mine'):
                valid=isinstance(value,dict) and set(value)=={'date','keys'} and isinstance(value.get('keys'),list) and len(value['keys'])<=10000 and all(isinstance(k,str) and len(k)<=100 for k in value['keys'])
                if valid and value['date'] is not None:
                    try:valid=isinstance(value['date'],str) and date.fromisoformat(value['date']).isoformat()==value['date']
                    except (ValueError,TypeError):valid=False
            if not valid:raise ValueError('设置无效')
            c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',(key,json.dumps(value)))
        else: raise ValueError('操作无效')
    return snapshot()

def migrate(d):
    """One-time transactional import; never overwrite authoritative SQLite rows."""
    if not isinstance(d,dict):raise ValueError('导入无效')
    with connect() as c:
        if c.execute("SELECT 1 FROM settings WHERE key='legacy_imported'").fetchone():return snapshot()
        follows=d.get('follows',{});history=d.get('history',{})
        if not isinstance(follows,dict) or not isinstance(history,dict) or len(follows)>10000 or len(history)>10000:raise ValueError('导入数据无效')
        for a in follows.values():
            anime(a);c.execute('INSERT OR IGNORE INTO follows VALUES (?,?)',(a['id'],json.dumps(a,ensure_ascii=False)))
        for h in history.values():
            progress(h);key=f"{h['anime']['id']}:{h['episode']:g}"
            c.execute('INSERT OR IGNORE INTO history VALUES (?,?)',(key,json.dumps(h,ensure_ascii=False)))
        c.execute('INSERT OR IGNORE INTO settings VALUES (?,?)',('dark',json.dumps(bool(d.get('dark',False)))))
        c.execute('INSERT INTO settings VALUES (?,?)',('legacy_imported','true'))
    return snapshot()

def cached(key):
    with connect() as c:row=c.execute('SELECT body,at FROM remote_cache WHERE key=?',(key,)).fetchone()
    return (json.loads(row[0]),row[1]) if row else None

def cache(key,body):
    with connect() as c:c.execute('INSERT OR REPLACE INTO remote_cache VALUES (?,?,?)',(key,json.dumps(body,ensure_ascii=False),time.time()))
