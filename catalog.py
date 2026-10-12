"""Complete monthly browse -> quarter catalog, no calendar substitution."""
import json, sqlite3, time, calendar, http.client
from pathlib import Path
from contextlib import contextmanager
from storage import data_dir
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

class UpstreamDataError(ValueError):
    pass

BASE = 'https://api.bgm.tv'
DB = data_dir() / 'cache.sqlite3'

def request(path):
    for attempt in range(3):
        try:
            from transport import get
            try:return get(path)
            except ValueError as e:raise UpstreamDataError('Bangumi 返回非 JSON 数据') from e
        except HTTPError as e:
            if e.code not in (429,500,502,503,504) or attempt == 2: raise
        except (URLError, TimeoutError, OSError, http.client.HTTPException):
            if attempt == 2: raise
        time.sleep(0.5 * (attempt+1))

def collect(year, quarter, fetch=request, progress=None):
    if not 1900 <= year <= 2100 or quarter not in range(1,5): raise ValueError('年份或季度无效')
    items = {}; pages = []; excluded = []
    for month in range(quarter*3-2,quarter*3+1):
        offset=0
        while True:
            path='/v0/subjects?'+urlencode(dict(type=2,year=year,month=month,sort='date',limit=100,offset=offset))
            d=fetch(path)
            if not isinstance(d.get('data'),list) or not isinstance(d.get('total'),int): raise UpstreamDataError('Bangumi 返回结构异常')
            rows=d['data']; pages.append(dict(month=month,offset=offset,total=d['total'],count=len(rows)))
            for x in rows:
                date=x.get('date','')
                if x.get('type')!=2 or not isinstance(date,str) or not date.startswith(f'{year}-{month:02d}-'):
                    excluded.append({"id":x.get("id"),"date":date,"requested_month":month}); continue
                items[x['id']]=x
            if progress: progress({'data':list(items.values()),'total':len(items),'pages':list(pages),'excluded':list(excluded),'synced_at':time.time(),'year':year,'quarter':quarter,'cache':'partial'})
            offset+=len(rows)
            if offset>=d['total']: break
            if not rows: raise UpstreamDataError('Bangumi 分页提前结束，拒绝缓存不完整季度')
            if offset>30000: raise ValueError('分页超出安全限制')
    return {'data':list(items.values()),'total':len(items),'pages':pages,'excluded':excluded,'synced_at':time.time(),'source':'Bangumi monthly browse','year':year,'quarter':quarter}

@contextmanager
def connection():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB)
    c.execute('CREATE TABLE IF NOT EXISTS catalog (key TEXT PRIMARY KEY, body TEXT NOT NULL)')
    try:
        with c:yield c
    finally:c.close()

def catalog(year, quarter, refresh=False):
    key=f'{year}:{quarter}'
    with connection() as c:
        row=c.execute('SELECT body FROM catalog WHERE key=?',(key,)).fetchone()
    old=json.loads(row[0]) if row else None
    if old and not refresh and time.time()-old['synced_at']<21600: return dict(old,cache='fresh')
    try:
        result=collect(year,quarter)
        with connection() as c: c.execute('INSERT OR REPLACE INTO catalog VALUES (?,?)',(key,json.dumps(result,ensure_ascii=False)))
        return dict(result,cache='network')
    except Exception as e:
        if old: return dict(old,cache='stale',warning=str(e))
        raise


def progressive_catalog(year,quarter,refresh=False):
    if not 1900<=year<=2100 or quarter not in range(1,5):raise ValueError('年份或季度无效')
    from jobs import run,active
    key=f'{year}:{quarter}'
    running=active('catalog:'+key)
    if running:return running
    with connection() as c:row=c.execute('SELECT body FROM catalog WHERE key=?',(key,)).fetchone()
    old=json.loads(row[0]) if row else None
    if old and not refresh and time.time()-old['synced_at']<21600:return dict(old,cache='fresh',running=False)
    initial=dict(old,cache='stale') if old else dict(data=[],total=0,pages=[],excluded=[],synced_at=0,cache='partial')
    def work(publish):
        def partial(value):
            if not old:publish(value)
        result=collect(year,quarter,progress=partial)
        with connection() as c:c.execute('INSERT OR REPLACE INTO catalog VALUES (?,?)',(key,json.dumps(result,ensure_ascii=False)))
        return dict(result,cache='network')
    return run('catalog:'+key,initial,work,refresh,21600)
