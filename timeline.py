"""Indexed episode timeline, stable keyset pages and on-demand older quarters."""
import json,base64,time
from datetime import datetime,date,timedelta,timezone
from concurrent.futures import ThreadPoolExecutor,as_completed
from storage import connect,cached,cache,snapshot
from jobs import run

MIN_YEAR=1900

def setup(c):
    c.executescript('''CREATE TABLE IF NOT EXISTS feed_subjects(sid INTEGER PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feed_records(key TEXT PRIMARY KEY,sid INTEGER NOT NULL,date TEXT NOT NULL,episode_id INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS feed_by_date ON feed_records(date DESC,episode_id DESC,key DESC);
    CREATE INDEX IF NOT EXISTS feed_by_subject ON feed_records(sid,date DESC);''')

def slim(a):
    keys=('id','bgmId','title','coverImage','averageScore','format','episodes','seasonYear','startDate','siteUrl','source') if a.get('bgmId') else ('id','name','name_cn','images','rating','platform','date','eps','total_episodes','type')
    return {k:a[k] for k in keys if k in a}

def index_subject(a,rows):
    from feed import build_events
    today=datetime.now(timezone(timedelta(hours=8))).date()
    events,_=build_events(a,rows,today,lookback=None);sid=a.get('bgmId') or a['id']
    offsets={ep['id']:(i//100)*100 for i,ep in enumerate(rows)}
    for e in events:e['page_offset']=offsets[e['episodeId']]
    with connect() as c:
        setup(c)
        c.execute('INSERT OR REPLACE INTO feed_subjects VALUES (?,?)',(sid,json.dumps(slim(a),ensure_ascii=False)))
        c.execute('DELETE FROM feed_records WHERE sid=?',(sid,))
        c.executemany('INSERT OR REPLACE INTO feed_records VALUES (?,?,?,?,?)',[(e['key'],sid,e['date'],e['episodeId'],json.dumps({k:v for k,v in e.items() if k!='anime'},ensure_ascii=False)) for e in events])

def quarter_start(y,q):return date(y,q*3-2,1)
def previous_quarter(day):
    q=(day.month-1)//3+1
    return (day.year-1,4) if q==1 else (day.year,q-1)

def archive(y,q,retry=False):
    from feed import episodes
    from catalog import progressive_catalog
    key=f'history-quarter-v1:{y}:{q}'
    old=cached(key)
    if old and old[0].get('complete') and time.time()-old[1]<7*86400 and not retry:return dict(old[0],running=False)
    def work(publish):
        request_refresh=retry
        while True:
            cat=progressive_catalog(y,q,request_refresh)
            request_refresh=False
            if not cat.get('running'):break
            publish({'count':0,'total':cat['total'],'year':y,'quarter':q})
            time.sleep(1)
        if cat.get('warning'):raise OSError('历史季度目录同步未完成：'+cat['warning'])
        subjects=cat['data'];results=[];errors=[]
        def fetch(a):
            rows,_,_,warning=episodes(a['id'])
            index_subject(a,rows)
            if warning:raise OSError(warning)
        with ThreadPoolExecutor(max_workers=3) as pool:
            tasks={pool.submit(fetch,a):a['id'] for a in subjects}
            for task in as_completed(tasks):
                try:task.result()
                except Exception as e:errors.append({'subject_id':tasks[task],'error':str(e)})
                results.append(True)
                publish({'count':len(results),'total':len(subjects),'failed':len(errors),'year':y,'quarter':q})
        if errors:
            return {'complete':False,'count':len(results),'total':len(subjects),'year':y,'quarter':q,'errors':errors,'warning':f'{len(errors)} 部历史资料请求失败，可重试；已同步资料保留'}
        value={'complete':True,'count':len(results),'total':len(subjects),'year':y,'quarter':q,'synced_at':time.time()}
        cache(key,value)
        return value
    return run(key,{'count':0,'total':0,'year':y,'quarter':q},work,retry,3600)

def encode_cursor(mode,before,floor):
    return base64.urlsafe_b64encode(json.dumps({'mode':mode,'before':before,'floor':floor},separators=(',',':')).encode()).decode()

def decode_cursor(cursor,mode,today):
    try:
        if len(cursor)>1024:raise ValueError()
        value=json.loads(base64.b64decode(cursor.encode(),altchars=b'-_',validate=True))
        if value['mode']!=mode:raise ValueError()
        floor=date.fromisoformat(value['floor']);before=value['before']
        if not MIN_YEAR<=floor.year<=today.year or floor>today or floor.day!=1 or floor.month not in (1,4,7,10):raise ValueError()
        if before is not None:
            if not isinstance(before,list) or len(before)!=3 or not isinstance(before[1],int) or isinstance(before[1],bool) or before[1]<=0 or not isinstance(before[2],str) or len(before[2])>100:raise ValueError()
            if date.fromisoformat(before[0])>=today:raise ValueError()
        return before,floor
    except (ValueError,TypeError,KeyError,UnicodeError):raise ValueError('历史分页游标无效')

def query(mode,before,floor,limit,today):
    state=snapshot();ids=[a['bgmId'] for a in state['follows'].values() if a.get('bgmId')]
    where=['r.date<?'];args=[today.isoformat()]
    if mode=='all':where.append('r.date>=?');args.append(floor.isoformat())
    elif ids:where.append('r.sid IN ('+','.join('?' for _ in ids)+')');args.extend(ids)
    else:return []
    if before:
        where.append('(r.date,r.episode_id,r.key)<(?,?,?)');args.extend(before)
    with connect() as c:
        setup(c)
        rows=c.execute('SELECT r.body,s.body,r.date,r.episode_id,r.key FROM feed_records r JOIN feed_subjects s ON s.sid=r.sid WHERE '+' AND '.join(where)+' ORDER BY r.date DESC,r.episode_id DESC,r.key DESC LIMIT ?',args+[limit+1]).fetchall()
    result=[]
    for body,a,day,eid,key in rows:
        e=json.loads(body);e['anime']=json.loads(a);e['read']=key in state['reads'];result.append(e)
    return result

def page(mode='all',cursor=None,limit=24,retry=False):
    from feed import progressive_feed
    if mode not in ('all','mine') or not 1<=limit<=48:raise ValueError('历史分页参数无效')
    today=datetime.now(timezone(timedelta(hours=8))).date()
    y,q=previous_quarter(today)
    before,floor=decode_cursor(cursor,mode,today) if cursor else (None,quarter_start(y,q))
    status=progressive_feed(mode)
    failures=sum(bool(r.get('error') or r.get('warning')) for r in status.get('results',[]))
    if retry and (failures or status.get('warning')):status=progressive_feed(mode,True)
    rows=query(mode,before,floor,limit,today)
    loading=status.get('running',False);warning=status.get('warning') or (f'{failures} 部作品未成功同步，已加载资料保留，可重试' if failures and not loading else None);archive_status=None
    # Hold the initial cursor until the newest scope settles: no unstable offset pages.
    if loading:return {'events':rows[:limit] if not cursor else [],'next_cursor':cursor,'has_more':True,'loading':True,'warning':warning,'archive':None}
    if mode=='all' and len(rows)<=limit and floor.year>=MIN_YEAR:
        y,q=previous_quarter(floor)
        if y>=MIN_YEAR:
            archive_status=archive(y,q,retry)
            warning=archive_status.get('warning') or warning
            if archive_status.get('complete'):
                floor=quarter_start(y,q);rows=query(mode,before,floor,limit,today)
            else:loading=archive_status.get('running',False)
    chosen=rows[:limit]
    next_before=[chosen[-1]['date'],chosen[-1]['episodeId'],chosen[-1]['key']] if chosen else before
    can_extend=mode=='all' and floor>date(MIN_YEAR,1,1)
    more=len(rows)>limit or can_extend or loading or bool(warning)
    return {'events':chosen,'next_cursor':encode_cursor(mode,next_before,floor.isoformat()) if more else None,'has_more':more,'loading':loading,'warning':warning,'archive':archive_status,'end_reason':None if more else '尚未追番，可在资料库详情中添加追番' if mode=='mine' and not status.get('total_subjects',1) else '已加载可确认日期的全部记录'}


def latest(mode='all'):
    """Newest recorded day and recent keys; older archive inserts cannot create a badge."""
    if mode not in ('all','mine'):raise ValueError('动态模式无效')
    today=datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    ids=[a['bgmId'] for a in snapshot()['follows'].values() if a.get('bgmId')]
    if mode=='mine' and not ids:return {'date':None,'keys':[]}
    where='date<?';args=[today]
    if mode=='mine':where+=' AND sid IN ('+','.join('?' for _ in ids)+')';args.extend(ids)
    with connect() as c:
        setup(c)
        day=c.execute('SELECT MAX(date) FROM feed_records WHERE '+where,args).fetchone()[0]
        cutoff=(date.fromisoformat(today)-timedelta(days=14)).isoformat()
        keys=[] if not day else [r[0] for r in c.execute('SELECT key FROM feed_records WHERE '+where+' AND date>=? ORDER BY key',args+[cutoff])]
    return {'date':day,'keys':keys}
