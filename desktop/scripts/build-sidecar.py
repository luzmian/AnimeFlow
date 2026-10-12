"""Build on the target OS; PyInstaller does not cross-compile Windows EXEs."""
from pathlib import Path
import subprocess,sys,platform,shutil,struct
root=Path(__file__).resolve().parents[1];project=root.parent
if struct.calcsize('P')!=8 or platform.machine().lower() not in ('x86_64','amd64'):raise SystemExit('This build currently supports x64 only')
target='x86_64-pc-windows-msvc' if sys.platform=='win32' else 'x86_64-unknown-linux-gnu' if sys.platform=='linux' else None
if not target:raise SystemExit('Build on Windows x64 or Linux x64')
args=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onefile','--name','animeflow-service','--distpath',str(root/'sidecar-dist'),'--workpath',str(root/'sidecar-work'),'--specpath',str(root/'sidecar-work')]
for item in ['index.html','app.js','player.js','style.css','assets']:
 destination='assets' if item=='assets' else '.'
 args+=['--add-data',str(project/item)+(';' if sys.platform=='win32' else ':')+destination]
args.append(str(project/'server.py'));subprocess.run(args,cwd=project,check=True)
ext='.exe' if sys.platform=='win32' else ''
destination=root/'src-tauri/binaries'/f'animeflow-service-{target}{ext}'
destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'sidecar-dist'/('animeflow-service'+ext),destination);print(destination)
