"""Run the prebuilt React UI in a browser. This is not the Tauri desktop EXE."""
from pathlib import Path
import os,sys,subprocess,threading,queue,json,secrets,webbrowser
root=Path(__file__).resolve().parent
if not (root/'desktop/dist/index.html').exists():raise SystemExit('预览文件缺失，请完整解压项目。')
env=dict(os.environ,AF_PORT='0',AF_DESKTOP_TOKEN=secrets.token_urlsafe(32),AF_DESKTOP_PARENT_PID=str(os.getpid()),AF_DESKTOP_UI_DIR=str(root/'desktop/dist'))
child=subprocess.Popen([sys.executable,str(root/'server.py')],cwd=root,env=env,stdout=subprocess.PIPE,text=True)
try:
 ready=queue.Queue();threading.Thread(target=lambda:ready.put(child.stdout.readline()),daemon=True).start()
 value=json.loads(ready.get(timeout=15));port=value['port']
 if not webbrowser.open(f'http://127.0.0.1:{port}/desktop/?session='+env['AF_DESKTOP_TOKEN']):print('浏览器未能自动打开，请确认系统默认浏览器后重新启动。',flush=True)
 print('AnimeFlow 界面预览已启动。关闭此命令窗口或按 Ctrl+C 退出。',flush=True)
 child.wait()
except KeyboardInterrupt:pass
except Exception as e:print('预览启动失败：'+str(e));sys.exit(1)
finally:
 if child.poll() is None:
  child.terminate()
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:child.kill();child.wait()
 if child.stdout:child.stdout.close()
