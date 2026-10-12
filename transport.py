"""Verified TLS, per-thread keep-alive, stdlib only; respects system proxy."""
import http.client,threading,json,io,base64
from urllib.request import getproxies,proxy_bypass,Request,urlopen
from urllib.parse import urlsplit,unquote
from urllib.error import HTTPError
_local=threading.local()
def get(path):
    headers={'Accept':'application/json','User-Agent':'AnimeFlow/0.4.0 (personal desktop catalog)'}
    proxy=getproxies().get('https') if not proxy_bypass('api.bgm.tv') else None
    parsed=urlsplit(proxy) if proxy else None
    # Secure/other proxy modes retain urllib's established handling.
    if parsed and parsed.scheme!='http':
        with urlopen(Request('https://api.bgm.tv'+path,headers=headers),timeout=25) as r:return json.load(r)
    conn=getattr(_local,'connection',None)
    if conn is None:
        if parsed:
            conn=http.client.HTTPSConnection(parsed.hostname,parsed.port or 80,timeout=25)
            tunnel_headers={}
            if parsed.username:
                credentials=unquote(parsed.username)+':'+unquote(parsed.password or '')
                tunnel_headers['Proxy-Authorization']='Basic '+base64.b64encode(credentials.encode()).decode()
            conn.set_tunnel('api.bgm.tv',443,headers=tunnel_headers)
        else:conn=http.client.HTTPSConnection('api.bgm.tv',timeout=25)
        _local.connection=conn
    try:
        conn.request('GET',path,headers=headers)
        response=conn.getresponse();body=response.read()
        if response.will_close:conn.close();_local.connection=None
        if response.status>=400:raise HTTPError('https://api.bgm.tv'+path,response.status,response.reason,response.headers,io.BytesIO(body))
        return json.loads(body)
    except Exception:
        conn.close();_local.connection=None
        raise
