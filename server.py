"""AnimeFlow local development server and same-origin Bangumi API relay."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, parse_qs
import json
from catalog import progressive_catalog as catalog, UpstreamDataError
from storage import snapshot, mutate, migrate, data_dir
from feed import progressive_feed, episode_page, remote
from sources import links
from timeline import page as timeline_page,slim
from pathlib import Path
import os
import re
import hashlib
import tempfile
import hmac, sys, threading, time, mimetypes
from http.cookies import SimpleCookie
from urllib.parse import unquote

os.chdir(Path(__file__).resolve().parent)
DESKTOP_TOKEN=os.environ.get('AF_DESKTOP_TOKEN','')
UI_DIR=Path(os.environ['AF_DESKTOP_UI_DIR']).resolve() if os.environ.get('AF_DESKTOP_UI_DIR') else None
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Content-Type-Options','nosniff')
        if DESKTOP_TOKEN:
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost; frame-ancestors 'none'; base-uri 'self'")
        super().end_headers()
    def authorized(self):
        if not DESKTOP_TOKEN:return True
        cookie=SimpleCookie()
        try:cookie.load(self.headers.get('Cookie',''))
        except Exception:return False
        name='af_session_'+str(self.server.server_port)
        return name in cookie and hmac.compare_digest(cookie[name].value,DESKTOP_TOKEN)
    def log_message(self,format,*args):
        # Desktop emits a single readiness JSON on stdout; never log session URLs.
        if not DESKTOP_TOKEN:super().log_message(format,*args)
    def desktop_file(self):
        path=unquote(urlsplit(self.path).path)
        if not UI_DIR:return self.json_response(404,{'error':'桌面界面尚未构建'})
        rel=path[len('/desktop/'):]
        if not rel:rel='index.html'
        file=(UI_DIR/rel).resolve()
        if not file.is_relative_to(UI_DIR) or not file.is_file() or any(part.startswith('.') for part in Path(rel).parts):return self.json_response(404,{'error':'文件不存在'})
        body=file.read_bytes();self.send_response(200)
        self.send_header('Content-Type',mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store' if file.name=='index.html' else 'public, max-age=3600')
        self.end_headers();self.wfile.write(body)

    def do_GET(self):
        parsed=urlsplit(self.path)
        if DESKTOP_TOKEN and parsed.path=='/desktop/' and 'session' in parse_qs(parsed.query):
            token=parse_qs(parsed.query)['session'][0]
            if not hmac.compare_digest(token,DESKTOP_TOKEN):return self.json_response(403,{'error':'桌面会话无效'})
            self.send_response(303);self.send_header('Location','/desktop/')
            self.send_header('Set-Cookie',f'af_session_{self.server.server_port}={DESKTOP_TOKEN}; HttpOnly; SameSite=Lax; Path=/')
            self.send_header('Content-Length','0');self.end_headers();return
        if not self.authorized():return self.json_response(403,{'error':'桌面会话未授权'})
        if parsed.path.startswith('/desktop/'):return self.desktop_file()
        if urlsplit(self.path).path == '/api/episodes':
            try:
                q=parse_qs(urlsplit(self.path).query)
                return self.json_response(200,episode_page(int(q['subject_id'][0]),int(q.get('offset',['0'])[0]),q.get('refresh',['0'])[0]=='1'))
            except UpstreamDataError as e:return self.json_response(502,{'error':str(e),'kind':'upstream_data'})
            except (ValueError,KeyError):return self.json_response(400,{'error':'剧集参数无效'})
            except Exception as e:return self.json_response(502,{'error':str(e)})
        if urlsplit(self.path).path == '/api/sources':
            try:return self.json_response(200,links(int(parse_qs(urlsplit(self.path).query)['subject_id'][0])))
            except (ValueError,KeyError):return self.json_response(400,{'error':'条目 ID 无效'})
        if urlsplit(self.path).path == '/api/state':return self.json_response(200,snapshot())
        if urlsplit(self.path).path == '/api/catalog/updates':
            try:
                from catalog_updates import updates
                q=parse_qs(urlsplit(self.path).query)
                return self.json_response(200,updates(int(q['year'][0]),int(q['quarter'][0]),q.get('refresh',['0'])[0]=='1'))
            except (ValueError,KeyError) as e:return self.json_response(400,{'error':str(e)})
            except Exception as e:return self.json_response(502,{'error':str(e)})
        if urlsplit(self.path).path == '/api/feed/latest':
            try:
                from timeline import latest
                return self.json_response(200,latest(parse_qs(urlsplit(self.path).query).get('mode',['all'])[0]))
            except ValueError as e:return self.json_response(400,{'error':str(e)})
            except Exception as e:return self.json_response(502,{'error':str(e)})
        if urlsplit(self.path).path == '/api/feed/page':
            try:
                q=parse_qs(urlsplit(self.path).query)
                return self.json_response(200,timeline_page(q.get('mode',['all'])[0],q.get('cursor',[None])[0],int(q.get('limit',['24'])[0]),q.get('retry',['0'])[0]=='1'))
            except ValueError as e:return self.json_response(400,{'error':str(e)})
            except Exception as e:return self.json_response(502,{'error':str(e)})
        if urlsplit(self.path).path == '/api/feed':return self.get_feed()
        if urlsplit(self.path).path not in ('/','/index.html','/app.js','/player.js','/style.css') and not self.path.startswith(('/cover/','/api/catalog?','/bgm/')):
            self.send_error(404);return
        if self.path.startswith('/cover/'):
            return self.cover()
        if self.path.startswith('/api/catalog?'):
            return self.get_catalog()
        if self.path.startswith('/bgm/'):
            return self.relay()
        return super().do_GET()
    def do_POST(self):
        if not self.authorized():return self.json_response(403,{'error':'桌面会话未授权'})
        if self.path in ('/api/state','/api/migrate'):
            origin=self.headers.get('Origin')
            if origin and origin not in (f'http://localhost:{self.server.server_port}',f'http://127.0.0.1:{self.server.server_port}'):
                return self.json_response(403,{'error':'Origin not allowed'})
            if not self.headers.get('Content-Type','').startswith('application/json'):
                return self.json_response(415,{'error':'JSON required'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=5_000_000:raise ValueError('请求大小无效')
                d=json.loads(self.rfile.read(length))
                result=migrate(d) if self.path=='/api/migrate' else mutate(d)
                return self.json_response(200,result)
            except (ValueError,KeyError,TypeError) as e:return self.json_response(400,{'error':str(e)})
            except Exception:return self.json_response(500,{'error':'本地数据库写入失败，操作未确认保存'})
        if self.path.startswith('/bgm/'):
            return self.relay()
        self.send_error(404)
    def json_response(self,status,data):
        body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
    def get_feed(self):
        try:
            q=parse_qs(urlsplit(self.path).query)
            d=progressive_feed(q.get('mode',['all'])[0],q.get('refresh',['0'])[0]=='1')
            d['last_sync']=max([r.get('synced_at',0) or 0 for r in d['results']]+[d.get('calendar_synced_at') or 0])
            d['failures']=sum(bool(r.get('error') or r.get('warning')) for r in d['results'])
            for e in d['schedule']:e['anime']=slim(e['anime'])
            for key in ('events','subjects','results'):d.pop(key,None)
            return self.json_response(200,d)
        except UpstreamDataError as e:return self.json_response(502,{'error':str(e),'kind':'upstream_data'})
        except ValueError as e:return self.json_response(400,{'error':str(e),'kind':'validation'})
        except HTTPError as e:return self.json_response(502,{'error':f'Bangumi HTTP {e.code}','kind':'upstream_api'})
        except Exception as e:return self.json_response(502,{'error':str(e),'kind':'network'})
    def cover(self):
        path=self.path[len('/cover'):]
        if not re.fullmatch(r'/[a-zA-Z0-9_./-]+',path) or '..' in path:
            self.send_error(400);return
        cache=data_dir()/'covers';cache.mkdir(parents=True,exist_ok=True)
        file=cache/hashlib.sha256(path.encode()).hexdigest()
        try:
            if file.exists(): data=file.read_bytes()
            else:
                with urlopen(Request('https://lain.bgm.tv'+path,headers={'User-Agent':'AnimeFlow/0.4.0'}),timeout=20) as r:
                    mime=r.headers.get('Content-Type','')
                    if not mime.startswith('image/'):raise ValueError('Invalid image response')
                    data=r.read(8_000_001)
                    if len(data)>8_000_000:raise ValueError('Image too large')
                with tempfile.NamedTemporaryFile(dir=cache,delete=False) as temp:
                    temp.write(data);temp_path=Path(temp.name)
                temp_path.replace(file)
            mime='image/png' if data.startswith(bytes([137,80,78,71])) else 'image/webp' if data[:4]==b'RIFF' and data[8:12]==b'WEBP' else 'image/gif' if data[:3]==b'GIF' else 'image/jpeg'
            self.send_response(200);self.send_header('Content-Type',mime)
            self.send_header('Cache-Control','public, max-age=86400')
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        except Exception: self.send_error(502,'Cover unavailable')
    def get_catalog(self):
        try:
            q=parse_qs(urlsplit(self.path).query)
            data=catalog(int(q['year'][0]),int(q['quarter'][0]),q.get('refresh',['0'])[0]=='1')
            status=200
        except UpstreamDataError as e:
            status=502; data={'error':str(e),'kind':'upstream_data'}
        except (ValueError, KeyError) as e:
            status=400; data={'error':str(e),'kind':'validation'}
        except HTTPError as e:
            status=502; data={'error':f'Bangumi HTTP {e.code}','kind':'upstream_api','upstream_status':e.code}
        except Exception as e:
            status=502; data={'error':str(e),'kind':'network'}
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def relay(self):
        path=self.path[len('/bgm'):]
        parsed=urlsplit(path)
        if not (parsed.path == '/v0/subjects' or parsed.path == '/calendar' or parsed.path == '/v0/episodes' or parsed.path.startswith('/v0/subjects/') or parsed.path == '/v0/search/subjects'):
            self.send_error(403, 'Endpoint not allowed');return
        if self.command=='GET':
            try:
                value,_,_,_=remote('detail:'+path,path)
                return self.json_response(200,value)
            except Exception as e:return self.json_response(502,{'error':str(e)})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>32768: self.send_error(413);return
            body=self.rfile.read(size) if self.command=='POST' else None
            req=Request('https://api.bgm.tv'+path,data=body,method=self.command,headers={
                'User-Agent':'AnimeFlow/0.4.0 (local personal anime browser)',
                'Accept':'application/json','Content-Type':'application/json'})
            try:
                with urlopen(req,timeout=18) as resp: status=resp.status; data=resp.read(3_000_000)
            except HTTPError as e: status=e.code;data=e.read(30000)
        except (URLError,TimeoutError,OSError) as e:
            status=502;data=json.dumps({'error':'Bangumi network connection failed: '+str(e)}).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers();self.wfile.write(data)
def parent_alive(pid):
    if os.name=='nt':
        import ctypes
        from ctypes import wintypes
        api=ctypes.WinDLL('kernel32',use_last_error=True)
        api.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];api.OpenProcess.restype=wintypes.HANDLE
        api.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];api.WaitForSingleObject.restype=wintypes.DWORD
        api.CloseHandle.argtypes=[wintypes.HANDLE]
        handle=api.OpenProcess(0x100000,False,pid)
        if not handle:return False
        try:return api.WaitForSingleObject(handle,0)==258
        finally:api.CloseHandle(handle)
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False
    except PermissionError:return True

def main():
    port=int(os.environ.get('AF_PORT','5173'))
    if not 0<=port<=65535:raise ValueError('Invalid port')
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.daemon_threads=True
    parent=int(os.environ.get('AF_DESKTOP_PARENT_PID','0'))
    if parent:
        def watch():
            while parent_alive(parent):time.sleep(1)
            server.shutdown()
        threading.Thread(target=watch,daemon=True).start()
    if DESKTOP_TOKEN:print(json.dumps({'ready':True,'port':server.server_port,'protocol':1}),flush=True)
    else:print(f'AnimeFlow running at http://localhost:{server.server_port}',flush=True)
    try:server.serve_forever()
    finally:server.server_close()
if __name__=='__main__':main()
