"""Single-flight progressive jobs: readers never wait for network work."""
import threading,time,copy
_lock=threading.RLock()
_jobs={}
def run(key,initial,worker,refresh=False,ttl=3600):
    with _lock:
        old=_jobs.get(key)
        if old and (old['running'] or (not refresh and time.time()-old['started']<ttl)):
            return copy.deepcopy(old['value'])
        job={'running':True,'started':time.time(),'value':dict(initial,running=True)}
        _jobs[key]=job
        def publish(value):
            with _lock:job['value']=dict(value,running=True)
        def work():
            try:
                result=worker(publish)
                with _lock:job['value']=dict(result,running=False)
            except Exception as e:
                with _lock:job['value']=dict(job['value'],running=False,warning=str(e))
            finally:
                with _lock:job['running']=False
        threading.Thread(target=work,daemon=True).start()
        return copy.deepcopy(job['value'])


def active(key):
    with _lock:
        job=_jobs.get(key)
        return copy.deepcopy(job['value']) if job and job['running'] else None
