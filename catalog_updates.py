"""Latest confirmed episode DATE per subject; never API cache modification time."""
import time,copy
from datetime import datetime,timedelta,timezone
from concurrent.futures import ThreadPoolExecutor,as_completed
from catalog import progressive_catalog
from feed import episodes,build_events
from storage import cached,cache,connect
from timeline import setup,index_subject
from jobs import run,active

def indexed_updates(ids,today):
 result={}
 with connect() as c:
  setup(c)
  for start in range(0,len(ids),400):
   batch=ids[start:start+400]
   if not batch:continue
   rows=c.execute('SELECT sid,MAX(date) FROM feed_records WHERE date<? AND sid IN ('+','.join('?' for _ in batch)+') GROUP BY sid',[today.isoformat(),*batch])
   result.update({str(sid):day for sid,day in rows})
 return result

def updates(year,quarter,refresh=False):
 cat=progressive_catalog(year,quarter)
 today=datetime.now(timezone(timedelta(hours=8))).date();key=f'catalog-updates-v1:{year}:{quarter}'
 old=cached(key);existing=active(key)
 if existing:return existing
 ids=[a['id'] for a in cat['data']]
 initial={'updates':indexed_updates(ids,today),'count':0,'total':len(ids),'errors':[],'synced_at':None,'today':today.isoformat(),'scope_ids':sorted(ids)}
 if old:
  scope=set(map(str,ids))
  for k,v in old[0]['updates'].items():
   if k in scope and v<today.isoformat():initial['updates'][k]=max(v,initial['updates'].get(k,''))
 if cat.get('running'):return dict(initial,running=True,catalog_loading=True)
 if cat.get('warning'):return dict(initial,running=False,warning=cat['warning'])
 if old and not refresh and time.time()-old[1]<3600 and old[0]['today']==today.isoformat() and old[0].get('scope_ids')==sorted(ids) and not old[0]['errors']:return dict(old[0],updates=initial['updates'],running=False)
 def work(publish):
  value=dict(initial);value['errors']=[];value['count']=0
  def fetch(a):
   rows,_,_,warning=episodes(a['id'],refresh)
   index_subject(a,rows)
   past,_=build_events(a,rows,today,lookback=None)
   return str(a['id']),max((e['date'] for e in past),default=None),warning
  with ThreadPoolExecutor(max_workers=3) as pool:
   tasks={pool.submit(fetch,a):a['id'] for a in cat['data']}
   for task in as_completed(tasks):
    sid=str(tasks[task])
    try:
     sid,day,warning=task.result()
     if day:value['updates'][sid]=day
     elif not warning:value['updates'].pop(sid,None)
     if warning:value['errors'].append({'id':sid,'error':warning})
    except Exception as e:value['errors'].append({'id':sid,'error':str(e)})
    value['count']+=1;publish(copy.deepcopy(value))
  value['synced_at']=time.time();cache(key,value);return value
 restart=refresh or bool(old and (old[0].get('scope_ids')!=sorted(ids) or old[0]['today']!=today.isoformat() or time.time()-old[1]>=3600))
 return run(key,initial,work,restart,3600)
