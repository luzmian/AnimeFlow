"""Community episode records & separately labeled schedule; never stream availability."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone,date
import time
from catalog import request, UpstreamDataError
from storage import cached,cache,snapshot

def remote(key,path,refresh=False):
    old=cached(key)
    if old and not refresh and time.time()-old[1]<3600:return old[0],old[1],'cache',None
    try:
        d=request(path);cache(key,d);return d,time.time(),'network',None
    except Exception as e:
        if old:return old[0],old[1],'stale',str(e)
        raise

def episode_page(subject_id,offset=0,refresh=False):
    if subject_id<=0 or offset<0:raise ValueError('剧集参数无效')
    d,at,state,warning=remote(f'episode-page:{subject_id}:{offset}',f'/v0/episodes?subject_id={subject_id}&type=0&limit=100&offset={offset}',refresh)
    if not isinstance(d.get('data'),list) or not isinstance(d.get('total'),int):raise UpstreamDataError('剧集接口结构异常')
    return dict(d,synced_at=at,cache=state,warning=warning)

def valid_date(s):
    try:return date.fromisoformat(s) if isinstance(s,str) and len(s)==10 else None
    except ValueError:return None

def episodes(subject_id,refresh=False):
    key=f'episodes-all-v2:{subject_id}';old=cached(key)
    if old and not refresh and time.time()-old[1]<3600:return old[0],old[1],'cache',None
    try:
        first=request(f'/v0/episodes?subject_id={subject_id}&type=0&limit=100&offset=0')
        if not isinstance(first.get('data'),list) or not isinstance(first.get('total'),int):raise UpstreamDataError('剧集接口结构异常')
        total=first['total'];data=list(first['data'])
        if total<0 or total>30000:raise UpstreamDataError('剧集数量超出安全范围')
        while len(data)<total:
            page=request(f'/v0/episodes?subject_id={subject_id}&type=0&limit=100&offset={len(data)}')
            if not isinstance(page.get('data'),list) or not page['data']:raise UpstreamDataError('剧集分页提前结束，未缓存不完整资料')
            data.extend(page['data'])
        cache(key,data);return data,time.time(),'network',None
    except Exception as e:
        if old:return old[0],old[1],'stale',str(e)
        raise

def build_events(subject,rows,today,lookback=14):
    sid=subject.get('bgmId') or subject.get('id');history=[];schedule=[]
    for ep in rows:
        day=valid_date(ep.get('airdate'));n=ep.get('sort')
        if ep.get('type')!=0 or not day or not isinstance(n,(int,float)) or n<=0:continue
        event={'key':f"{sid}:{ep['id']}",'bgmId':sid,'episodeId':ep['id'],'number':n,'title':ep.get('name_cn') or ep.get('name') or '',
               'date':day.isoformat(),'anime':subject,'source':'Bangumi episode record','stream_available':None}
        # Same-day data has no exact airtime: remains schedule, never marked released.
        if day<today and (lookback is None or today-timedelta(days=lookback)<=day):history.append(dict(event,kind='record'))
        elif today<=day<=today+timedelta(days=6):schedule.append(dict(event,kind='schedule'))
    return history,schedule

def sync(mode='all',offset=0,limit=24,refresh=False):
    if mode not in ('all','mine') or offset<0 or not 1<=limit<=24:raise ValueError('动态参数无效')
    state=snapshot();calendar_error=None;calendar_at=None
    if mode=='mine':subjects=list(state['follows'].values());subjects=[a for a in subjects if a.get('bgmId')]
    else:
        d,calendar_at,cal_cache,calendar_error=remote('calendar','/calendar',refresh)
        if not isinstance(d,list):raise UpstreamDataError('每日放送结构异常')
        by_id={a['id']:a for day in d for a in day.get('items',[]) if a.get('type')==2}
        subjects=sorted(by_id.values(),key=lambda a:(-a.get('rating',{}).get('total',0),a['id']))
    batch=subjects[offset:offset+limit];today=datetime.now(timezone(timedelta(hours=8))).date()
    def work(a):
        sid=a.get('bgmId') or a['id']
        try:
            rows,at,source,error=episodes(sid,refresh);past,future=build_events(a,rows,today)
            return {'subject_id':sid,'events':past,'schedule':future,'synced_at':at,'cache':source,'warning':error}
        except Exception as e:return {'subject_id':sid,'events':[],'schedule':[],'error':str(e)}
    with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(work,batch))
    events=[e for r in results for e in r['events']];schedule=[e for r in results for e in r['schedule']]
    for e in events:e['read']=e['key'] in state['reads']
    events.sort(key=lambda e:(e['date'],e['episodeId']),reverse=True);schedule.sort(key=lambda e:(e['date'],e['episodeId']))
    return {'events':events,'schedule':schedule,'subjects':batch,'total_subjects':len(subjects),'offset':offset,'count':len(batch),
            'has_next':offset+len(batch)<len(subjects),'results':[{k:v for k,v in r.items() if k not in ('events','schedule')} for r in results],
            'today':today.isoformat(),'calendar_synced_at':calendar_at,'calendar_warning':calendar_error,
            'coverage':'完整正篇分页，未知日期不推测','meaning':'社区逐集播出日期记录，不代表平台实际上线','mode':mode}


def progressive_feed(mode='all',refresh=False):
    from jobs import run,active
    from catalog import connection,progressive_catalog
    import json
    state=snapshot()
    if mode not in ('all','mine'):raise ValueError('动态模式无效')
    ids=sorted(state['follows']) if mode=='mine' else []
    if mode=='mine' and not ids:
        return dict(events=[],schedule=[],subjects=[],total_subjects=0,count=0,results=[],today=datetime.now(timezone(timedelta(hours=8))).date().isoformat(),running=False,has_next=False,mode=mode,calendar_synced_at=None,calendar_warning=None)
    key='feed-v3:'+mode+':'+','.join(ids)
    saved=cached(key)
    ongoing=active(key)
    if not ongoing and saved and not refresh and time.time()-saved[1]<3600 and saved[0].get('today')==datetime.now(timezone(timedelta(hours=8))).date().isoformat() and saved[0].get('count')==saved[0].get('total_subjects') and not saved[0].get('calendar_warning') and not any(r.get('error') or r.get('warning') for r in saved[0].get('results',[])):
        result=dict(saved[0],running=False)
        for e in result['events']:e['read']=e['key'] in state['reads']
        return result
    today=datetime.now(timezone(timedelta(hours=8))).date()
    legacy=cached('feed:'+mode+':'+','.join(ids))
    initial=saved[0] if saved else legacy[0] if legacy else dict(events=[],schedule=[],subjects=[],total_subjects=0,count=0,results=[],today=today.isoformat(),has_next=False,mode=mode)
    def work(publish):
        try:calendar,at,_,warning=remote('calendar','/calendar',refresh)
        except Exception as e:calendar=[];at=None;warning='放送表未同步：'+str(e)
        by_id={a['id']:a for day in calendar for a in day.get('items',[]) if a.get('type')==2}
        weekdays={a['id']:day['weekday']['id'] for day in calendar for a in day.get('items',[]) if a.get('type')==2}
        if mode=='mine':by_id={a['bgmId']:a for a in state['follows'].values() if a.get('bgmId')}
        else:
            # Include ONA/films/regional works absent from the weekly TV calendar.
            q=(today.month-1)//3+1
            progressive_catalog(today.year,q)
            previous=(today.year-1,4) if q==1 else (today.year,q-1)
            progressive_catalog(*previous)
            with connection() as c:
                for y,quarter in [(today.year,q),previous]:
                    row=c.execute('SELECT body FROM catalog WHERE key=?',(f'{y}:{quarter}',)).fetchone()
                    if row:
                        for a in json.loads(row[0])['data']:by_id.setdefault(a['id'],a)
            for a in state['follows'].values():
                if a.get('bgmId'):by_id.setdefault(a['bgmId'],a)
        subjects=list(by_id.values());events={e['key']:e for e in initial['events'] if e['bgmId'] in by_id and (today-timedelta(days=14)).isoformat()<=e['date']<today.isoformat()};scheduled={};results=[]
        for sid,a in by_id.items():
            if sid in weekdays:
                delta=(weekdays[sid]-1-today.weekday())%7;day=today+timedelta(days=delta)
                scheduled[f'weekly:{sid}']={'key':f'weekly:{sid}','bgmId':sid,'anime':a,'date':day.isoformat(),'number':None,'kind':'weekly','source':'Bangumi calendar'}
        def current():
            return dict(events=sorted(events.values(),key=lambda e:(e['date'],e['episodeId']),reverse=True),schedule=sorted(scheduled.values(),key=lambda e:e['date']),subjects=subjects,total_subjects=len(subjects),count=len(results),results=list(results),today=today.isoformat(),has_next=False,mode=mode,calendar_synced_at=at,calendar_warning=warning)
        publish(current())
        def fetch(a):
            sid=a.get('bgmId') or a['id']
            try:
                rows,stamp,source,error=episodes(sid,refresh)
                from timeline import index_subject
                index_subject(a,rows)
                past,future=build_events(a,rows,today)
                return sid,past,future,dict(subject_id=sid,synced_at=stamp,cache=source,warning=error)
            except Exception as e:return sid,[],[],dict(subject_id=sid,error=str(e))
        from concurrent.futures import as_completed
        with ThreadPoolExecutor(max_workers=3) as pool:
            for task in as_completed([pool.submit(fetch,a) for a in subjects]):
                sid,past,future,result=task.result();results.append(result)
                if not result.get('error'):
                    events={k:e for k,e in events.items() if e['bgmId']!=sid}
                for e in past:events[e['key']]=e
                if future:scheduled.pop(f'weekly:{sid}',None)
                for e in future:scheduled[e['key']]=e
                value=current();cache(key,value);publish(value)
        if mode=='all':
            # First-launch catalog jobs may not yet have been cached when the scan began.
            # Wait in this background worker, then scan the newly discovered works too.
            for y,quarter in [(today.year,q),previous]:
                while True:
                    cat=progressive_catalog(y,quarter)
                    if not cat.get('running'):break
                    time.sleep(1)
                extra=[]
                for a in cat.get('data',[]):
                    if a['id'] not in by_id:by_id[a['id']]=a;subjects.append(a);extra.append(a)
                publish(current())
                with ThreadPoolExecutor(max_workers=3) as pool:
                    for sid,past,future,result in pool.map(fetch,extra):
                        results.append(result)
                        for e in past:events[e['key']]=e
                        for e in future:scheduled[e['key']]=e
                        value=current();cache(key,value);publish(value)
        value=current();cache(key,value)
        return value
    result=run(key,initial,work,refresh,3600)
    for e in result['events']:e['read']=e['key'] in state['reads']
    return result
