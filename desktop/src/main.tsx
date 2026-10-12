import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {invoke,isTauri} from '@tauri-apps/api/core';
import original from '../../index.html?raw';
import '../../style.css';
import './shell.css';
const markup=original.split('<body>')[1].split('</body>')[0].replace(/<script[\s\S]*?<\/script>/g,'');
function App(){
 const local=location.hostname==='127.0.0.1'&&location.pathname.startsWith('/desktop/');
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!local){
   if(!isTauri()){setError('请通过本地服务或桌面程序打开 AnimeFlow。');return;}
   invoke<string>('service_url').then(url=>location.replace(url)).catch(e=>setError('启动失败：'+String(e)));
   return;
  }
  const player=document.createElement('script');player.src='/player.js';const script=document.createElement('script');script.src='/app.js';
  player.onload=()=>document.body.append(script);player.onerror=script.onerror=()=>setError('界面加载失败，请关闭后重新打开。');document.body.append(player);
  const open=(event:MouseEvent)=>{
   const a=(event.target as Element).closest<HTMLAnchorElement>('a[href]');if(!a||!isTauri())return;
   if(a.protocol==='https:'){event.preventDefault();invoke('open_official',{url:a.href}).catch(e=>alert('页面未打开：'+String(e)))}
  };
  document.addEventListener('click',open);return()=>{document.removeEventListener('click',open);script.remove();player.remove()};
 },[local]);
 if(error)return <div className="startup"><h1>AnimeFlow</h1><p role="alert">{error}</p><button onClick={()=>location.reload()}>重试</button></div>;
 if(!local)return <div className="startup"><h1>AnimeFlow</h1><p role="status">正在打开你的动漫世界…</p></div>;
 return <div id="legacy-root" dangerouslySetInnerHTML={{__html:markup}}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
