/* Local media only. Files remain in memory; SQLite stores progress, never file bytes. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id), sessions=new Map();
 const panel=document.createElement('section');panel.id='playerPanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','本地视频播放器');
 panel.innerHTML=`<div class="player-shell"><header><div><h2 id="playerTitle"></h2><p id="playerFileName" class="muted"></p></div><button id="playerClose" aria-label="关闭播放器">关闭</button></header><div id="videoStage"><video id="localVideo" controls playsinline preload="metadata"></video><div id="danmakuLayer" aria-hidden="true"></div></div><div class="player-tools"><button id="chooseVideo">选择本地视频</button><input id="localVideoFile" type="file" accept="video/*,.mkv,.mp4,.webm,.mov" hidden><button id="playerPrev">上一集</button><button id="playerNext">下一集</button><label>倍速 <select id="playbackRate"><option>0.5</option><option>0.75</option><option selected>1</option><option>1.25</option><option>1.5</option><option>2</option></select></label><button id="playerFullscreen">全屏</button><button id="chooseSubtitle">导入字幕</button><input id="subtitleFile" type="file" accept=".vtt,.srt" hidden><label><input id="subtitleEnabled" type="checkbox" checked>字幕</label><button id="chooseDanmaku">导入弹幕</button><input id="danmakuFile" type="file" accept=".xml,.json" multiple hidden><label><input id="mergeDanmaku" type="checkbox" checked>合并弹幕</label><button id="clearDanmaku">清空弹幕</button></div><details class="danmaku-settings"><summary>弹幕设置</summary><div class="player-tools"><label><input id="danmakuEnabled" type="checkbox" checked>弹幕</label><label>透明度 <input id="danmakuOpacity" type="range" min="0.1" max="1" step="0.1" value="0.8"></label><label>字号 <select id="danmakuFont"><option>18</option><option selected>24</option><option>30</option><option>36</option></select></label><label>速度 <select id="danmakuSpeed"><option value="12">慢</option><option value="8" selected>中</option><option value="5">快</option></select></label><label>区域 <select id="danmakuArea"><option value="0.25">25%</option><option value="0.5" selected>50%</option><option value="0.75">75%</option><option value="1">100%</option></select></label></div></details><p id="playerStatus" role="status"></p><p class="muted">选择你有权观看的视频；音量、暂停和全屏使用视频控制条。刷新后需重新选择文件。字幕支持 SRT / VTT，弹幕支持本地 XML / JSON。</p></div>`;
 document.body.append(panel);
 const video=$('localVideo'),layer=$('danmakuLayer');const background=[...document.body.children].filter(el=>el!==panel&&el.tagName!=='SCRIPT');const inertBefore=new Map();
 let context=null,url=null,subtitleURL=null,revision=0,lastSave=0,lastSavedPosition=-1,pendingRestore=0,raf=0,comments=[],commentIndex=0,active=[],previousTime=0,played=false;
 let originalOverflow='',returnFocus=null;
 let settings={enabled:true,opacity:.8,font:24,speed:8,area:.5};
 const fingerprint=f=>({name:f.name,size:f.size,last_modified:f.lastModified});
 const sameFile=(a,b)=>a&&b&&a.name===b.name&&a.size===b.size&&a.last_modified===b.last_modified;
 const clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
 function status(s){$('playerStatus').textContent=s;}
 function record(){if(!context||!context.file||!played||!Number.isFinite(video.duration)||video.currentTime<=0)return null;return {anime:context.anime,episode:context.episode,seconds:Math.min(86400,video.currentTime),duration:Math.min(86400,video.duration),page_offset:context.pageOffset,captured_at:Date.now(),source:'local-file',media:fingerprint(context.file)};}
 function flush(force=false){const h=record();if(!h||(!force&&Date.now()-lastSave<5000)||Math.abs(h.seconds-lastSavedPosition)<.05)return Promise.resolve();const savedContext=context;lastSave=Date.now();lastSavedPosition=h.seconds;
  return context.persist({op:'progress',record:h}).then(()=>{if(context===savedContext){status(`进度已保存 · 第 ${h.episode} 集 ${clock(h.seconds)} / ${clock(h.duration)}`);context.onSave?.();}}).catch(e=>{if(context===savedContext){lastSavedPosition=-1;status('进度保存失败：'+e.message+'；请保持窗口打开后重试。');}});
 }
 function clearDanmaku(){active=[];layer.replaceChildren();cancelAnimationFrame(raf);raf=0;}
 function resetComments(){clearDanmaku();const t=video.currentTime;commentIndex=0;while(commentIndex<comments.length&&comments[commentIndex].time<t-.05)commentIndex++;previousTime=t;}
 function draw(){raf=0;if(video.paused||video.ended||panel.hidden)return;const t=video.currentTime;
  if(t<previousTime||t-previousTime>1.5)resetComments();previousTime=t;
  if(settings.enabled){
   active=active.filter(a=>{if(t>=a.end){a.el.remove();return false}if(a.mode===1)a.el.style.transform=`translateX(${layer.clientWidth-(t-a.start)/settings.speed*(layer.clientWidth+a.width)}px)`;return true});
   while(commentIndex<comments.length&&comments[commentIndex].time<=t){const c=comments[commentIndex++];if(t-c.time>.5||active.length>=60)continue;
    const region=layer.clientHeight*settings.area,rows=Math.max(1,Math.floor(region/(settings.font+8)));let row=-1,top=0;
    for(let i=0;i<rows;i++){const y=c.mode===4?Math.max(0,region-(i+1)*(settings.font+8)):i*(settings.font+8)+4;if(!active.some(a=>Math.abs(a.top-y)<settings.font+8)){row=i;top=y;break}}if(row<0)continue;
    const el=document.createElement('span');el.textContent=c.text;el.style.color=`#${c.color.toString(16).padStart(6,'0')}`;el.style.fontSize=settings.font+'px';el.style.opacity=settings.opacity;
    el.className='danmaku-text';el.style.top=top+'px';layer.append(el);const width=el.offsetWidth;
    if(c.mode!==1){el.style.left='50%';el.style.transform='translateX(-50%)'}else el.style.transform=`translateX(${layer.clientWidth}px)`;
    active.push({el,width,mode:c.mode,row,top,start:t,end:t+(c.mode===1?settings.speed:4)});
   }
  }else{layer.replaceChildren();active=[];while(commentIndex<comments.length&&comments[commentIndex].time<=t)commentIndex++;}
  raf=requestAnimationFrame(draw);
 }
 function startDraw(){if(!raf&&!video.paused)raf=requestAnimationFrame(draw);}
 function removeSubtitle(){video.querySelectorAll('track').forEach(t=>t.remove());if(subtitleURL)URL.revokeObjectURL(subtitleURL);subtitleURL=null;}
 function unload(){video.pause();video.removeAttribute('src');video.load();if(url)URL.revokeObjectURL(url);url=null;removeSubtitle();comments=[];clearDanmaku();played=false;lastSavedPosition=-1;}
 function updateNavigation(){const numbers=context.numbers;$('playerPrev').disabled=!numbers.some(n=>n<context.episode);$('playerNext').disabled=!numbers.some(n=>n>context.episode);$('playerTitle').textContent=`${context.anime.title?.english||context.anime.title?.romaji||context.anime.title?.native||'动漫'} · 第 ${context.episode} 集`;}
 async function attach(file){if(!context)return;const token=++revision,original=context;await flush(true);if(token!==revision||context!==original)return;unload();context.file=file;const key=`${context.anime.id}:${context.episode}`;sessions.delete(key);sessions.set(key,file);if(sessions.size>12)sessions.delete(sessions.keys().next().value);
  const old=context.history()[`${context.anime.id}:${context.episode}`];pendingRestore=old?.source==='local-file'&&sameFile(old.media,fingerprint(file))?old.seconds:0;
  if(old?.source==='local-file'&&!sameFile(old.media,fingerprint(file)))status('文件与历史记录不同，从头播放。');else status(pendingRestore?`将恢复到 ${clock(pendingRestore)}，点击播放继续。`:'视频正在读取，点击播放开始。');
  $('playerFileName').textContent=file.name;url=URL.createObjectURL(file);video.src=url;video.playbackRate=Number($('playbackRate').value);
 }
 async function open(options){const token=++revision;await flush(true);if(token!==revision)return;if(panel.hidden){originalOverflow=document.body.style.overflow;returnFocus=document.activeElement;for(const el of background){inertBefore.set(el,el.inert);el.inert=true}}unload();context={...options,file:null};panel.hidden=false;document.body.style.overflow='hidden';updateNavigation();$('playerFileName').textContent='尚未选择视频';
  const old=context.history()[`${context.anime.id}:${context.episode}`];status(old?.source==='local-file'?`上次播放 ${old.media.name}，进度 ${clock(old.seconds)}。请选择同一文件继续观看。`:'请选择本集对应的本地视频。');
  const file=sessions.get(`${context.anime.id}:${context.episode}`);if(file)await attach(file);$('playerClose').focus();
 }
 async function navigate(direction){const numbers=context.numbers.filter(n=>direction<0?n<context.episode:n>context.episode);const episode=direction<0?Math.max(...numbers):Math.min(...numbers);if(!Number.isFinite(episode))return;await open({...context,episode});}
 async function close(){const token=++revision;video.pause();await flush(true);if(token!==revision)return;unload();panel.hidden=true;context=null;document.body.style.overflow=originalOverflow;for(const el of background)el.inert=inertBefore.get(el)||false;inertBefore.clear();returnFocus?.focus();}
 $('playerClose').onclick=close;$('chooseVideo').onclick=()=>{$('localVideoFile').value='';$('localVideoFile').click()};
 $('localVideoFile').onchange=()=>{const f=$('localVideoFile').files[0];if(f)attach(f)};
 $('playerPrev').onclick=()=>navigate(-1);$('playerNext').onclick=()=>navigate(1);
 $('playerFullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('videoStage').requestFullscreen()}catch(e){status('无法进入全屏：'+e.message)}};
 $('playbackRate').onchange=()=>{video.playbackRate=Number($('playbackRate').value)};
 video.addEventListener('loadedmetadata',()=>{if(pendingRestore>0&&pendingRestore<video.duration-.1)video.currentTime=pendingRestore;pendingRestore=0;});
 video.addEventListener('play',()=>{played=true;startDraw()});video.addEventListener('timeupdate',()=>flush());
 video.addEventListener('pause',()=>{cancelAnimationFrame(raf);raf=0;flush(true)});video.addEventListener('ended',()=>{clearDanmaku();flush(true)});
 video.addEventListener('seeked',()=>{resetComments();startDraw();flush(true)});
 video.addEventListener('error',()=>{if(url)status('此视频无法解码。请选择当前浏览器支持的 MP4 / WebM 文件；MKV、HEVC 支持取决于系统。')});
 function subtitles(text){text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');if(/^WEBVTT(?:\s|$)/.test(text))return text;
  if(!/\d{2}:\d{2}:\d{2},\d{3}\s+-->/.test(text))throw Error('不是有效的 SRT / VTT 字幕');
  return 'WEBVTT\n\n'+text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2');
 }
 $('chooseSubtitle').onclick=()=>{$('subtitleFile').value='';$('subtitleFile').click()};
 $('subtitleFile').onchange=async()=>{const file=$('subtitleFile').files[0],token=revision;if(!file)return;try{if(file.size>5*1024*1024)throw Error('字幕文件请小于 5MB');const text=subtitles(await file.text());if(token!==revision)return;removeSubtitle();subtitleURL=URL.createObjectURL(new Blob([text],{type:'text/vtt'}));const track=document.createElement('track');track.kind='subtitles';track.srclang='zh';track.label=file.name;track.src=subtitleURL;track.default=true;video.append(track);track.onload=()=>{if(token!==revision)return;track.track.mode=$('subtitleEnabled').checked?'showing':'disabled';status('字幕已导入：'+file.name)};track.onerror=()=>status('字幕格式解析失败，请检查 UTF-8 编码与时间轴。');}catch(e){status('字幕未导入：'+e.message)}};
 $('subtitleEnabled').onchange=()=>{for(const t of video.textTracks)t.mode=$('subtitleEnabled').checked?'showing':'disabled'};
 function parseComments(text){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('弹幕 XML 不接受 DTD 或实体声明');let rows;
  if(text.trim().startsWith('<')){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('XML 格式无效');rows=[...doc.querySelectorAll('d[p]')].map(d=>{const p=d.getAttribute('p').split(',');return {time:Number(p[0]),mode:Number(p[1]),color:Number(p[3]),text:d.textContent}})}
  else{const obj=JSON.parse(text);rows=Array.isArray(obj)?obj:obj.comments;if(!Array.isArray(rows))throw Error('JSON 需要 comments 数组');rows=rows.map(c=>{if(typeof c.p==='string'){const p=c.p.split(',');return {time:Number(p[0]),mode:Number(p[1])===4?4:Number(p[1])===5?5:1,color:Number(p[2]),text:c.m}}return c})}
  if(rows.length>50000)throw Error('最多导入 50000 条弹幕');
  return rows.filter(c=>Number.isFinite(c.time)&&c.time>=0&&c.time<=86400&&[1,4,5].includes(c.mode)&&Number.isInteger(c.color)&&c.color>=0&&c.color<=0xffffff&&typeof c.text==='string'&&c.text.trim()).map(c=>({...c,text:c.text.slice(0,300)})).sort((a,b)=>a.time-b.time);
 }
 $('chooseDanmaku').onclick=()=>{$('danmakuFile').value='';$('danmakuFile').click()};
 $('danmakuFile').onchange=async()=>{const files=[...$('danmakuFile').files],token=revision;if(!files.length)return;try{if(files.some(f=>f.size>10*1024*1024)||files.reduce((n,f)=>n+f.size,0)>20*1024*1024)throw Error('每个弹幕文件需小于 10MB，总计小于 20MB');const parsed=(await Promise.all(files.map(async f=>parseComments(await f.text())))).flat();if(token!==revision)return;const combined=$('mergeDanmaku').checked?[...comments,...parsed]:parsed;if(combined.length>50000)throw Error('合并后最多 50000 条弹幕');const unique=new Map();for(const c of combined)unique.set(JSON.stringify([c.time,c.mode,c.color,c.text]),c);comments=[...unique.values()].sort((a,b)=>a.time-b.time);resetComments();startDraw();status(`已导入 ${comments.length} 条弹幕：${files.map(f=>f.name).join('、')}`)}catch(e){status('弹幕未导入：'+e.message)}};
 $('clearDanmaku').onclick=()=>{comments=[];resetComments();status('弹幕已清空')};
 function setSettings(s){settings={...settings,...s};$('danmakuEnabled').checked=settings.enabled;for(const [id,key]of [['danmakuOpacity','opacity'],['danmakuFont','font'],['danmakuSpeed','speed'],['danmakuArea','area']])$(id).value=settings[key];}
 for(const id of ['danmakuEnabled','danmakuOpacity','danmakuFont','danmakuSpeed','danmakuArea'])$(id).onchange=()=>{setSettings({enabled:$('danmakuEnabled').checked,opacity:Number($('danmakuOpacity').value),font:Number($('danmakuFont').value),speed:Number($('danmakuSpeed').value),area:Number($('danmakuArea').value)});resetComments();startDraw();context?.persist({op:'setting',key:'player_danmaku',value:settings}).catch(e=>status('弹幕设置未保存：'+e.message));};
 document.addEventListener('keydown',e=>{if(panel.hidden)return;if(e.key==='Tab'){const items=[...panel.querySelectorAll('button:not([disabled]),select,input:not([hidden]),summary,video')].filter(el=>el.offsetParent!==null);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}if(e.key==='Escape'&&!document.fullscreenElement){e.preventDefault();close()}});
 window.addEventListener('pagehide',()=>{const h=record();if(h)navigator.sendBeacon('/api/state',new Blob([JSON.stringify({op:'progress',record:h})],{type:'application/json'}));});
 window.AFPlayer={open,close,setSettings,subtitles,parseComments};
})();
