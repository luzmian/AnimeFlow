const API="https://graphql.anilist.co", $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true}catch(e){console.warn("本地缓存未保存：",e.message);return false}};
let follows=read("af_follows",{}),history=read("af_history",{}),feedMode=read("af_ui_feed_mode","mine")==="all"?"all":"mine",page=1,all=[],selected=null,tab=["library","feed","history"].includes(read("af_ui_tab","library"))?read("af_ui_tab","library"):"library";
let stateReady=false,writeQueue=Promise.resolve(),feedToken=0,feedData=null,feedOffset=0;
let updateBaselines={all:read("af_updates_all",null),mine:read("af_updates_mine",null)};
function uiSetting(key,value){if(stateReady)persist({op:"setting",key,value}).catch(e=>{$("storageStatus").textContent="设置未保存："+e.message})}
async function localApi(path,body){
 const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
 let d;try{d=await r.json()}catch{throw Error(`本地服务 HTTP ${r.status} 返回格式异常`)}
 if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;
}
function applyState(d){window.AFPlayer?.setSettings(d.settings?.player_danmaku||{});follows=d.follows;history=d.history;document.body.classList.toggle('dark',!!d.settings.dark)}
function persist(op){
 const task=writeQueue.catch(()=>{}).then(async()=>{
  if(!stateReady)throw Error('本地数据库尚未就绪，未保存修改');
  const d=await localApi('/api/state',op);applyState(d);return d;
 });writeQueue=task;return task;
}
async function initState(){
 try{
  const d=await localApi('/api/migrate',{follows:read('af_follows',{}),history:read('af_history',{}),dark:read('af_dark',false)});
  applyState(d);
  if(['library','feed','history'].includes(d.settings.ui_tab))tab=d.settings.ui_tab;
  if(['all','mine'].includes(d.settings.ui_feed_mode))feedMode=d.settings.ui_feed_mode;
  for(const mode of ['all','mine'])if(d.settings['update_baseline_'+mode])updateBaselines[mode]=d.settings['update_baseline_'+mode];
  document.querySelectorAll('[data-feed]').forEach(x=>x.classList.toggle('chosen',x.dataset.feed===feedMode));
  stateReady=true;$('storageStatus').textContent='追番与历史已保存到本机';
 }catch(e){$('storageStatus').textContent='本地数据未就绪：'+e.message;}
}
const currentYear=new Date().getFullYear(), season=["WINTER","SPRING","SUMMER","FALL"][Math.floor(new Date().getMonth()/3)];
$("year").innerHTML=Array.from({length:48},(_,i)=>`<option value="${currentYear+1-i}">${currentYear+1-i} 年</option>`).join("");
$("year").value=currentYear;$("season").value=season;
const query=`query($page:Int,$year:Int,$season:MediaSeason,$format:MediaFormat,$sort:[MediaSort]) { Page(page:$page,perPage:24) { pageInfo { hasNextPage } media(type:ANIME,seasonYear:$year,season:$season,format:$format,sort:$sort,isAdult:false) { id title { romaji english native } coverImage { large } description(asHtml:false) averageScore episodes format seasonYear season startDate { year month day } nextAiringEpisode { airingAt episode } siteUrl } } }`;
const detailQuery=`query($id:Int!) { Media(id:$id,type:ANIME) { id studios(isMain:true) { nodes { name } } staff(perPage:6) { nodes { name { full } } } characters(perPage:6) { edges { node { name { full } } voiceActors(language:JAPANESE) { name { full } } } } } }`;
async function gql(q,variables){
  let r;
  try { r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query:q,variables})}); }
  catch(e){throw Error("网络连接失败："+e.message)}
  const raw=await r.text();let d;
  try{d=JSON.parse(raw)}catch{throw Error(`API HTTP ${r.status}：服务器返回非 JSON 内容`)}
  if(d.errors?.length)throw Error(`API HTTP ${r.status}：`+d.errors.map(e=>e.message).join("；"));
  if(!r.ok)throw Error(`API HTTP ${r.status}：`+(d.message||"请求失败"));
  if(!d.data)throw Error("API 未返回数据");
  return d.data;
}

function name(a){return a.title?.english||a.title?.romaji||a.title?.native||"未命名动漫"}
function clean(s){return String(s||"").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")}
function score(a){return a.averageScore==null?"暂无":(a.averageScore/10).toFixed(1)}
function image(a){
 try{const u=new URL(a.coverImage?.large||'');if(u.hostname==='lain.bgm.tv'&&['https:','http:'].includes(u.protocol))return '/cover'+u.pathname;return u.protocol==='https:'?u.href:''}catch{return ''}
}
function date(d){return d?.year&&d?.month&&d?.day?`${d.year}-${String(d.month).padStart(2,"0")}-${String(d.day).padStart(2,"0")}`:"待定"}
let catalogUpdates={},updateSortToken=0,updateSortTimer=null;
async function loadUpdateSort(refresh=false){
 clearTimeout(updateSortTimer);const token=++updateSortToken,year=$('year').value,season=$('season').value;
 if($('sort').value!=='UPDATED_DESC'){$('updateSortNotice').hidden=true;return;}
 const q=['WINTER','SPRING','SUMMER','FALL'].indexOf(season)+1;
 $('updateSortNotice').hidden=false;$('updateSortNotice').textContent='正在读取最近播出记录…';
 try{
  const d=await localApi(`/api/catalog/updates?year=${year}&quarter=${q}&refresh=${refresh?1:0}`);
  if(token!==updateSortToken||year!==$('year').value||season!==$('season').value||$('sort').value!=='UPDATED_DESC')return;
  const signature=JSON.stringify(d.updates);if(signature!==JSON.stringify(catalogUpdates)){catalogUpdates=d.updates;renderCards();}
  $('updateSortNotice').textContent=`最近更新按已播出主篇剧集日期排序，未知日期排后。${d.running?'正在后台核对 '+d.count+'/'+d.total+' 部；当前排序可能继续变化。':'已核对 '+d.count+'/'+d.total+' 部。'}${d.errors?.length?' '+d.errors.length+' 部获取异常，保留可用旧资料。':''}${d.warning?' '+d.warning:''}`;
  if(d.running)updateSortTimer=setTimeout(()=>loadUpdateSort(),1500);
 }catch(e){if(token===updateSortToken)$('updateSortNotice').textContent='更新日期获取失败，保留旧资料：'+e.message;}
}
function renderCards(){let term=$("search").value.trim().toLowerCase(),items=all.filter(a=>[name(a),a.title?.native,a.title?.romaji].some(s=>s?.toLowerCase().includes(term)));const format=$("format").value;if(format)items=items.filter(a=>a.format===format);
 const region=$("region").value,genre=$("genre").value.trim();
 if(region)items=items.filter(a=>a.metaTags?.includes(region)||a.tags?.some(t=>t.name===region||(region==="中国"&&t.name==="国产")));
 if(genre)items=items.filter(a=>a.tags?.some(t=>t.name.includes(genre)));
 const sort=$("sort").value;items.sort((a,b)=> (sort==="UPDATED_DESC"?(catalogUpdates[b.bgmId]||"0000-00-00").localeCompare(catalogUpdates[a.bgmId]||"0000-00-00"):sort==="SCORE_DESC"?(b.averageScore||0)-(a.averageScore||0):sort==="START_DATE_DESC"?date(b.startDate).localeCompare(date(a.startDate)):(b.popularity||0)-(a.popularity||0))||a.bgmId-b.bgmId);
 const count=items.length;items=items.slice(0,page*24);$("more").hidden=items.length>=count;
 $("cards").innerHTML=items.map(a=>`<article class="card" data-id="${a.id}" data-update="${escapeHtml(catalogUpdates[a.bgmId]||'')}"><div class="poster"><img loading="lazy" src="${escapeHtml(image(a))}" alt=""><span class="score">★ ${score(a)}</span></div><strong>${escapeHtml(name(a))}</strong><small>${a.format||"动画"} · ${a.episodes||"?"} 集</small>${sort==='UPDATED_DESC'?`<small class="card-update">最近播出：${catalogUpdates[a.bgmId]||'无可确认更新'}</small>`:''}</article>`).join("");if(!items.length)$("cards").innerHTML='<p class="muted">没有符合条件的动漫。</p>';$("cards").querySelectorAll(".card").forEach(el=>el.onclick=()=>openDetail(Number(el.dataset.id)))}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const BGM="/bgm";
const seasonMonths={WINTER:[1,3],SPRING:[4,6],SUMMER:[7,9],FALL:[10,12]};
function fromBangumi(x){
 const rawDate=x.date||x.air_date||"";
 const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate);
 const eps=x.total_episodes||x.eps||0;
 return {id:1000000000+Number(x.id),bgmId:Number(x.id),source:"Bangumi",title:{english:x.name_cn||x.name||"",romaji:x.name||"",native:x.name||""},coverImage:{large:x.images?.large||x.images?.common||x.images?.medium||""},description:x.summary||"",averageScore:x.rating?.score?Math.round(x.rating.score*10):null,episodes:eps,popularity:Object.values(x.collection||{}).reduce((a,b)=>a+Number(b),0),tags:x.tags||[],metaTags:x.meta_tags||[],format:(x.platform==="剧场版"?"MOVIE":x.platform==="OVA"?"OVA":(x.platform==="ONA"||x.platform==="WEB")?"ONA":x.platform==="TV"?"TV":x.platform==="特别篇"?"SPECIAL":"动画"),seasonYear:m?Number(m[1]):null,startDate:m?{year:Number(m[1]),month:Number(m[2]),day:Number(m[3])}:null,nextAiringEpisode:null,siteUrl:`https://bgm.tv/subject/${x.id}`,studios:{nodes:(x.infobox||[]).filter(i=>i.key==="动画制作").flatMap(i=>Array.isArray(i.value)?i.value.map(v=>({name:v.v||""})):[{name:String(i.value)}])}};
}
async function bgmFetch(path,opts){const r=await fetch(BGM+path,{...opts,headers:{Accept:"application/json",...(opts?.headers||{})}});const body=await r.text();let j;try{j=JSON.parse(body)}catch{throw Error(`Bangumi HTTP ${r.status}（非 JSON 响应）`)}if(!r.ok)throw Error(`Bangumi HTTP ${r.status}：${JSON.stringify(j).slice(0,180)}`);return j}
async function bgmSearch(refresh=false){
 const y=Number($("year").value),q=["WINTER","SPRING","SUMMER","FALL"].indexOf($("season").value)+1;
 const r=await fetch(`/api/catalog?year=${y}&quarter=${q}&refresh=${refresh?1:0}`);
 const j=await r.json();if(!r.ok)throw Error(`${j.kind}: ${j.error}`);
 if(!Array.isArray(j.data))throw Error("季度接口结构异常");
 return {list:j.data.map(fromBangumi),hasNext:false,provider:"Bangumi 完整月份合并",meta:j};
}
// Bangumi episode records: type=0 means main episode; airdate is a scheduled date,
// not proof that a licensed stream is available. Unverified episodes stay locked.
const episodeCache=read("af_episode_cache",{});
function todayLocal(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function validEpisodeDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return null;const d=new Date(s+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null}
function normalizeEpisode(x){const n=Number(x.sort);return {id:Number(x.id),number:Number.isFinite(n)&&n>0?n:Number(x.ep||0),title:x.name_cn||x.name||"",airdate:validEpisodeDate(x.airdate),type:Number(x.type)}}
async function fetchEpisodes(bgmId,{refresh=false,offset=0}={}){
 const d=await localApi(`/api/episodes?subject_id=${bgmId}&offset=${offset}&refresh=${refresh?1:0}`);
 return {items:d.data.map(normalizeEpisode).filter(e=>e.type===0&&e.number>0),at:d.synced_at*1000,total:d.total,offset,hasNext:offset+d.data.length<d.total,cache:d.cache,warning:d.warning};
}
function episodeState(ep){if(!ep)return "unknown";if(!ep.airdate)return "unknown";return ep.airdate<todayLocal()?"aired":"future"}
function episodeMarkup(a,records){
 const byNumber=new Map((records||[]).map(e=>[e.number,e]));
 const numbers=[...byNumber.keys()].sort((a,b)=>a-b);const declared=Math.min(300,Number(a.episodes)||0);
 if(!numbers.length&&!declared)return '<p class="muted">尚未公布总集数或剧集列表。</p>';
 // Sequel records may use continuous numbering (13..25), not local 1..13.
 const display=numbers.length&&numbers[0]!==1?numbers:Array.from({length:Math.min(100,Math.max(declared,...numbers,0))},(_,i)=>i+1);
 return display.map(n=>{const e=byNumber.get(n),state=episodeState(e),enabled=state==="aired";
  const label=state==="future"?`预计 ${e.airdate} 播出`:state==="unknown"?"尚未确认播出日期":"已到播出日期";
  return `<button class="episode ${enabled?"episode-aired":"episode-locked"}" data-ep="${n}" ${enabled?"":"disabled"} title="${escapeHtml(label)}">第 ${n} 集${enabled?" ✓":""}</button>`;
 }).join("");
}
function updateEpisodeUI(a,records,notice=""){
 const grid=$("episodeGrid"),status=$("episodeStatus");if(!grid||!status)return;
 grid.innerHTML=episodeMarkup(a,records);
 const released=(records||[]).filter(e=>episodeState(e)==="aired").length;
 status.textContent=notice||`日期已过 ${released} 集；灰色集数为未播出或播出信息未确认。播出日期不代表片源已上线。`;
 grid.querySelectorAll("button:not([disabled])").forEach(b=>b.onclick=()=>{
  const n=Number(b.dataset.ep);$("episodeInput").value=n;
  status.textContent=`已选择第 ${n} 集。可在下方播放本地视频，或前往已登记的平台页面。`;
 });
 const input=$("episodeInput");if(input){input.max=Math.max(1,...(records||[]).filter(e=>episodeState(e)==="aired").map(e=>e.number));}
}
let loadToken=0;
async function load(reset=true,refresh=false){
 const updateRefresh=refresh,token=++loadToken;++updateSortToken;clearTimeout(updateSortTimer);catalogUpdates={};if(reset)page=1;
 const key=`af_catalog_v2_${$("year").value}_${$("season").value}`;
 const cached=read(key,null);all=cached?.items||[];renderCards();
 $("notice").textContent=cached?"正在显示本地缓存，后台同步季度资料…":"正在获取完整季度资料（三个月，含分页）…";
 $("more").hidden=true;
 try{
  let result; do {
  result=await bgmSearch(refresh);refresh=false;if(token!==loadToken)return;
  const m=result.meta;if(result.list.length||!m.running||!all.length)all=result.list;
  if(!m.running&&m.cache!=='partial')save(key,{items:all,at:m.synced_at*1000});renderCards();
  $("notice").textContent=`${m.cache==='stale'?'网络失败，显示旧缓存':m.cache==='fresh'?'缓存':'联网同步'} · 本季度 ${all.length} 部 · 最后同步 ${new Date(m.synced_at*1000).toLocaleString("zh-CN")}${m.excluded?.length?' · 排除 '+m.excluded.length+' 条日期缺失或不匹配资料':''}${m.warning?' · '+m.warning:''}${m.running?' · 后台继续查询，当前列表尚不完整':m.cache==='partial'?' · 查询中断，当前列表尚不完整':m.warning&&!all.length?' · 同步失败，不能判断无数据':all.length?'':' · API 成功返回，本季度暂无数据'}`;
  if(m.running)await new Promise(r=>setTimeout(r,1200));
  }while(result.meta.running&&token===loadToken);
  if(token===loadToken&&$('sort').value==='UPDATED_DESC')loadUpdateSort(updateRefresh);
 }catch(e){if(token!==loadToken)return;$("notice").textContent=`${cached?'联网失败，保留本季度缓存':'获取失败，不能判断本季度无数据'}：${e.message}`;}
}
let detailToken=0;const extraDetails=new Map();
async function openDetail(id,focusEpisode=null){
 const token=++detailToken;
 let candidate=all.find(a=>a.id===id)||extraDetails.get(id)||Object.values(follows).find(a=>a.id===id)||Object.values(history).find(h=>h.anime.id===id)?.anime;if(!candidate)return;
 $("shade").hidden=false;$("drawer").classList.add("open");$("detail").innerHTML='<p class="muted">正在加载动漫详情与播出集数…</p>';
 selected=candidate;let a=candidate,following=!!follows[id],next=a.nextAiringEpisode;
 let voices=a.characters?.edges?.slice(0,8).map(e=>`${e.node.name.full} — ${e.voiceActors?.[0]?.name.full||"待定"}`).join("、")||"暂无";
 $("detail").innerHTML=`<div class="hero"><img src="${escapeHtml(image(a))}" alt=""><div><h2>${escapeHtml(name(a))}</h2><p>${escapeHtml(a.title?.native||"")}</p><p>★ ${score(a)} / 10（${a.source||"AniList"} 单一来源评分）</p><p>${a.format||"动画"} · ${a.seasonYear||""} · ${date(a.startDate)}</p><button class="primary" id="follow">${following?"✓ 已追番 · 点击取消":"+ 追番"}</button></div></div><h3 class="section-title">剧情简介</h3><p id="detailSummary">${escapeHtml(clean(a.description)||"简介正在补充…")}</p><p class="muted">${escapeHtml(a.detailWarning||"")}</p><h3 class="section-title">制作信息</h3><p id="detailStudio">制作公司：${escapeHtml(a.studios?.nodes?.map(n=>n.name).join("、")||"正在补充")}</p><p id="detailStaff">工作人员（前 10 位）：${escapeHtml(a.staff?.nodes?.slice(0,10).map(n=>n.name.full).join("、")||"待定")}</p><p id="detailVoices">角色 / 声优（前 8 位）：${escapeHtml(voices)}</p><p>下一集：${next?`第 ${next.episode} 集 · ${new Date(next.airingAt*1000).toLocaleString("zh-CN")}`:"请参考下方逐集播出日期"}</p><h3 class="section-title">集数</h3><p id="episodeStatus" class="muted">正在查询 Bangumi 剧集播出日期…</p><div id="episodeGrid" class="episodes"></div><div class="seg"><button id="epPrev" hidden>上一页剧集</button><span id="epPage" class="muted"></span><button id="epNext" hidden>下一页剧集</button></div><a href="${a.siteUrl||"https://anilist.co"}" target="_blank" rel="noopener noreferrer">查看原始资料 ↗</a><h3 class="section-title">平台页面</h3><div id="platformLinks" class="muted">正在读取平台资料…</div><h3 class="section-title">本地播放与观看进度</h3><button id="playLocal" class="primary">播放本地视频</button><p class="muted">点击已播出集数可填写进度；可播放自己的本地视频并自动记录进度。</p><input type="number" id="episodeInput" min="1" value="1" style="width:85px" aria-label="集数"> 集 <input type="number" id="minutesInput" min="0" value="10" style="width:85px" aria-label="已看分钟"> 分钟 <button id="saveProgress">保存</button>`;
 if(a.bgmId){
  bgmFetch(`/v0/subjects/${a.bgmId}`).then(raw=>{if(token!==detailToken)return;const fresh=fromBangumi(raw);if(!fresh.studios?.nodes?.length&&a.studios?.nodes?.length)fresh.studios=a.studios;Object.assign(a,fresh);$('detailSummary').textContent=clean(a.description)||'暂无简介';$('detailStudio').textContent='制作公司：'+(a.studios?.nodes?.map(n=>n.name).join('、')||'待定')}).catch(()=>{if(token===detailToken)$('detailSummary').textContent=clean(a.description)||'简介同步失败，稍后可重试'});
  bgmFetch(`/v0/subjects/${a.bgmId}/persons`).then(rows=>{if(token!==detailToken)return;$('detailStaff').textContent='工作人员（前 10 位）：'+rows.slice(0,10).map(p=>`${p.name}（${p.relation}）`).join('、');const studios=rows.filter(p=>p.relation==='动画制作').map(p=>p.name);if(studios.length){a.studios={nodes:studios.map(name=>({name}))};$('detailStudio').textContent='制作公司：'+studios.join('、')}}).catch(()=>{if(token===detailToken)$('detailStaff').textContent='工作人员：同步失败，可稍后重试'});
  bgmFetch(`/v0/subjects/${a.bgmId}/characters`).then(rows=>{if(token!==detailToken)return;$('detailVoices').textContent='角色 / 声优（前 8 位）：'+rows.slice(0,8).map(c=>`${c.name} — ${(c.actors||[]).map(v=>v.name).join('、')||'待定'}`).join('、')}).catch(()=>{if(token===detailToken)$('detailVoices').textContent='角色 / 声优：同步失败，可稍后重试'});
 }
 $('follow').onclick=async()=>{
  $('follow').disabled=true;
  try{await persist(follows[id]?{op:'unfollow',id}:{op:'follow',anime:a});$('follow').textContent=follows[id]?'✓ 已追番 · 点击取消':'+ 追番';if(tab==='feed'){feedData=null;resetFeed();renderFeed();}}
  catch(e){alert('追番未保存：'+e.message)}finally{if($('follow'))$('follow').disabled=false;}
 };
 let records=[],recordPageOffset=0;
 $('playLocal').onclick=()=>{const ep=Number($('episodeInput').value);const numbers=records.filter(e=>episodeState(e)==='aired').map(e=>e.number).sort((a,b)=>a-b);if(!numbers.includes(ep)){alert('请先选择已确认播出日期的剧集。');return}window.AFPlayer.open({anime:a,episode:ep,numbers,pageOffset:recordPageOffset,history:()=>history,persist,onSave:()=>{if(tab==='history')renderHistory()}});};
 $('saveProgress').onclick=async()=>{
  let ep=Number($('episodeInput').value),mins=Number($('minutesInput').value);
  if(!records.some(e=>e.number===ep&&episodeState(e)==='aired')){alert('该集尚未确认播出日期，不能记录观看进度。');return}
  if(!Number.isFinite(mins)||mins<0||mins>1440){alert('请输入 0～1440 的观看分钟数');return}
  $('saveProgress').disabled=true;
  try{await persist({op:'progress',record:{anime:a,episode:ep,seconds:Math.floor(mins*60),page_offset:recordPageOffset}});$('episodeStatus').textContent='观看进度已保存到本机。';}
  catch(e){alert('进度未保存：'+e.message)}finally{if($('saveProgress'))$('saveProgress').disabled=false;}
 };
 if(a.bgmId){
  localApi(`/api/sources?subject_id=${a.bgmId}`).then(d=>{if(token!==detailToken||!$('platformLinks'))return;
   $('platformLinks').innerHTML=d.links.map(link=>`<a class="platform-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.name)} ↗ <small>${escapeHtml(link.regions.join(' / ')||'地区未注明')}</small></a>`).join('')||'没有登记的国内平台页面。';
   $('platformLinks').innerHTML+=`<p class="muted">${escapeHtml(d.notice)} 来源：bangumi-data，${escapeHtml(d.retrieved)}。</p>`;
  }).catch(e=>{if(token===detailToken&&$('platformLinks'))$('platformLinks').textContent='平台资料未读取：'+e.message});
 }else{$('platformLinks').textContent='未匹配到 Bangumi 条目，无法核验平台映射。';}
 const previous=Object.values(history).filter(h=>h.anime.id===id&&(!focusEpisode||h.episode===focusEpisode.number)).sort((a,b)=>b.at-a.at)[0];
 if(previous){if(!focusEpisode)focusEpisode={number:previous.episode,page_offset:previous.page_offset};$('episodeInput').value=previous.episode;$('minutesInput').value=(previous.seconds/60).toFixed(1);}
 if(a.bgmId){
  let epOffset=0;
  async function showEpisodes(offset){
   $('episodeStatus').textContent='正在查询剧集资料…';
   try{
    let data=await fetchEpisodes(a.bgmId,{offset});if(token!==detailToken)return;
    if(focusEpisode&&offset===0&&focusEpisode.number>Math.max(0,...data.items.map(e=>e.number))){data=await fetchEpisodes(a.bgmId,{offset:Math.max(data.total-100,0)});if(token!==detailToken)return;}
    epOffset=data.offset;recordPageOffset=epOffset;records=data.items;
    updateEpisodeUI(a,records,data.warning?'同步失败，保留剧集缓存：'+data.warning:'');
    $('epPrev').hidden=epOffset===0;$('epNext').hidden=!data.hasNext;
    $('epPage').textContent=data.total?`资料 ${epOffset+1}～${epOffset+records.length} / ${data.total} 条${data.cache==='stale'?' · 旧缓存':''}`:'暂无正片剧集资料';
    if(focusEpisode){$('episodeInput').value=focusEpisode.number;focusEpisode=null;}
   }catch(e){if(token!==detailToken)return;updateEpisodeUI(a,records,`剧集资料请求失败：${e.message}。${records.length?'保留先前页已加载资料。':'本页无法确认播出状态。'}`);}
  }
  $('epPrev').onclick=()=>showEpisodes(Math.max(0,epOffset-100));$('epNext').onclick=()=>showEpisodes(epOffset+100);
  await showEpisodes(Number.isInteger(focusEpisode?.page_offset)?focusEpisode.page_offset:0);
 }else{updateEpisodeUI(a,[],'该来源缺少可核验的逐集资料，无法确认播出状态。')}

}
function close(){ ++detailToken; $("drawer").classList.remove("open");$("shade").hidden=true}
$("close").onclick=close;$("shade").onclick=close;document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
function feedAnime(raw){return raw.bgmId?raw:fromBangumi(raw)}
let feedRows=[],feedMap=new Map(),feedCursor=null,feedHasMore=true,feedBusy=false,feedWaiting=false,feedPageError=false,feedGeneration=0,feedTimer=null,pageTimer=null,feedRange='',calendarSignature='',feedImageTimer=null;
const FEED_ROW_HEIGHT=132,FEED_DATE_HEIGHT=44;
let feedLayout=[],feedLayoutHeight=0;
function rebuildFeedLayout(){
 feedLayout=[];let previous=null,offset=0;
 for(const e of feedRows){if(e.date!==previous){feedLayout.push({key:'day:'+e.date,day:e.date,offset,height:FEED_DATE_HEIGHT});offset+=FEED_DATE_HEIGHT;previous=e.date;}
  feedLayout.push({key:'event:'+e.key,event:e,offset,height:FEED_ROW_HEIGHT});offset+=FEED_ROW_HEIGHT;
 }feedLayoutHeight=offset;
}
function layoutIndexAt(y){let lo=0,hi=feedLayout.length;while(lo<hi){const mid=(lo+hi)>>1;if(feedLayout[mid].offset+feedLayout[mid].height<=y)lo=mid+1;else hi=mid;}return lo;}
function feedDateTitle(day){const [y,m,d]=day.split('-').map(Number);return `${y}年${m}月${d}日`;}

function resetFeed(preserve=false){
 ++feedGeneration;if(!preserve){feedRows=[];feedMap.clear();rebuildFeedLayout();}feedCursor=null;feedHasMore=true;feedBusy=false;feedWaiting=false;feedPageError=false;feedRange='';calendarSignature='';clearTimeout(feedTimer);clearTimeout(pageTimer);
}
function renderFeedRows(){
 if(tab!=='feed')return;
 const container=$('events'),top=container.getBoundingClientRect().top+window.scrollY;
 const start=Math.max(0,Math.min(feedLayout.length,layoutIndexAt(Math.max(0,window.scrollY-top-6*FEED_ROW_HEIGHT))));
 const end=Math.min(feedLayout.length,start+60,layoutIndexAt(Math.max(0,window.scrollY-top)+window.innerHeight+6*FEED_ROW_HEIGHT)+1);
 const existing=new Map([...container.querySelectorAll('[data-layout-key]')].map(n=>[n.dataset.layoutKey,n]));
 const nodes=[],spacer=height=>{const n=document.createElement('div');n.setAttribute('aria-hidden','true');n.style.height=height+'px';return n};
 nodes.push(spacer(feedLayout[start]?.offset??feedLayoutHeight));
 for(const item of feedLayout.slice(start,end)){
  let node=existing.get(item.key);
  if(item.day){if(!node){node=document.createElement('h3');node.className='feed-date';node.dataset.layoutKey=item.key;node.dataset.day=item.day;node.textContent=feedDateTitle(item.day);}nodes.push(node);continue;}
  const e=item.event,a=feedAnime(e.anime),signature=JSON.stringify([name(a),image(a),e.number,e.date,e.title]);
  if(!node){node=document.createElement('div');node.className='feed-row';node.dataset.record=e.key;node.dataset.layoutKey=item.key;}
  if(node.dataset.signature!==signature){node.dataset.signature=signature;node.innerHTML=`<div class="entry" role="button" tabindex="0" data-event="${escapeHtml(e.key)}" aria-label="${escapeHtml(name(a))} 第 ${e.number} 集，打开详情"><img loading="lazy" src="${escapeHtml(image(a))}" alt=""><div class="grow"><b title="${escapeHtml(name(a))}">${escapeHtml(name(a))}</b><p title="${escapeHtml(e.title||'')}">第 ${e.number} 集${e.title?' · '+escapeHtml(e.title):''}</p><small>社区播出记录 · 平台上线未知</small></div><time class="feed-time" datetime="${escapeHtml(e.date)}">${escapeHtml(e.date)}<small>时刻未提供</small></time></div>`;}
  nodes.push(node);
 }
 nodes.push(spacer(feedLayoutHeight-(feedLayout[end]?.offset??feedLayoutHeight)));
 if(!feedRows.length){const n=document.createElement('p');n.className='muted';n.textContent=feedWaiting?'正在整理播出记录，完成后自动显示…':'还没有已加载记录；缺失播出日期不会推测。';nodes.splice(0,nodes.length,n);}
 // Move only when order changes; unchanged rows stay attached to the document.
 const keep=new Set(nodes);for(const n of [...container.childNodes])if(!keep.has(n))n.remove();
 nodes.forEach((n,i)=>{if(container.childNodes[i]!==n)container.insertBefore(n,container.childNodes[i]||null)});
 $('feedMore').hidden=!feedHasMore;$('feedMore').disabled=feedBusy||feedWaiting;
 $('feedMore').textContent=feedPageError?'重试加载':feedBusy||feedWaiting?'正在加载更早记录…':'继续加载动态';
}
function renderFeed(){
 if(!feedData){renderFeedRows();loadFeed();return;}
 const d=feedData,signature=d.today+':'+d.schedule.map(e=>e.key+e.date).join('|');
 if(signature!==calendarSignature){
  calendarSignature=signature;
  const days=Array.from({length:7},(_,i)=>{const day=new Date(d.today+'T12:00:00+08:00');day.setUTCDate(day.getUTCDate()+i);return day.toISOString().slice(0,10)});
  $('weekCalendar').innerHTML=days.map(day=>`<section class="day"><b>${day.slice(5)} · ${['日','一','二','三','四','五','六'][new Date(day+'T12:00:00+08:00').getUTCDay()]}</b><small>预计播出 · ${d.schedule.filter(e=>e.date===day).length} 条</small><div class="day-list">${d.schedule.filter(e=>e.date===day).map(e=>`<button data-schedule="${escapeHtml(e.key)}">${escapeHtml(name(feedAnime(e.anime)))}<small>${e.kind==='weekly'?'常规放送日 · 集数未公布':'第 '+e.number+' 集'}</small></button>`).join('')||'<p class="muted">暂无已知日程</p>'}</div></section>`).join('');
 }
 renderFeedRows(true);
}
$('events').onkeydown=event=>{if(['Enter',' '].includes(event.key)&&event.target.matches('[data-event]')){event.preventDefault();event.target.click()}};
$('events').onclick=event=>{
 const button=event.target.closest('[data-event]');if(!button)return;const e=feedMap.get(button.dataset.event);if(!e)return;
 const a=feedAnime(e.anime);extraDetails.set(a.id,a);openDetail(a.id,e);
};
$('weekCalendar').onclick=event=>{const b=event.target.closest('[data-schedule]');if(!b||!feedData)return;const e=feedData.schedule.find(e=>e.key===b.dataset.schedule);if(!e)return;const a=feedAnime(e.anime);extraDetails.set(a.id,a);openDetail(a.id)};
async function loadFeedPage(retry=false){
 if(tab!=='feed'||feedBusy||!feedHasMore||feedPageError&&!retry)return;
 clearTimeout(pageTimer);feedLoadArmed=false;feedBusy=true;const generation=feedGeneration,mode=feedMode,cursor=feedCursor;
 renderFeedRows(true);
 try{
  const d=await localApi(`/api/feed/page?mode=${mode}&limit=24${cursor?'&cursor='+encodeURIComponent(cursor):''}${retry?'&retry=1':''}`);if(generation!==feedGeneration)return;
  if(!cursor&&(!d.loading||d.events.length)){feedRows=d.events;feedMap=new Map(feedRows.map(e=>[e.key,e]));}
  else for(const e of d.events){if(!feedMap.has(e.key)){feedRows.push(e);feedMap.set(e.key,e)}}
  rebuildFeedLayout();feedCursor=d.next_cursor;feedHasMore=d.has_more;feedWaiting=d.loading;feedPageError=!!d.warning;
  $('feedEnd').textContent=d.warning?'历史查询暂未完成：'+d.warning+'。点击重试，已加载记录保留。':!d.has_more?d.end_reason||'已到可确认记录的末尾':d.loading?'正在同步更早的资料，完成后自动继续…':`已加载 ${feedRows.length} 条，向下滚动继续查看更早记录`;
 }catch(e){if(generation!==feedGeneration)return;feedPageError=true;feedWaiting=false;$('feedEnd').textContent='加载失败，已加载记录保留：'+e.message;}
 finally{
  if(generation===feedGeneration){feedBusy=false;renderFeedRows(true);
   if(feedWaiting&&!feedPageError)pageTimer=setTimeout(()=>loadFeedPage(),1500);

  }
 }
}
async function loadFeed(more=false,refresh=false){
 if(more){const retry=feedPageError;feedPageError=false;feedWaiting=false;loadFeedPage(retry);return;}
 if(refresh){resetFeed(true);window.scrollTo(0,0)}
 clearTimeout(feedTimer);const token=++feedToken,mode=feedMode;
 try{
  const d=await localApi(`/api/feed?mode=${mode}&refresh=${refresh?1:0}`);if(token!==feedToken)return;
  feedData=d;renderFeed();
  const at=d.last_sync,lastSync=at?new Date(at*1000).toLocaleString('zh-CN'):'尚未同步';
  $('feedNotice').textContent=`${mode==='mine'?'我的追番':'全部播出记录'}${d.running?' · 后台同步中':''}${d.failures?' · '+d.failures+' 部资料获取异常':''} · 最近同步 ${lastSync}${d.warning?' · '+d.warning:''}${d.calendar_warning?' · '+d.calendar_warning:''}。日历仅为预计，历史记录可继续向前加载。`;
  if((!feedRows.length||refresh)&&!feedBusy)loadFeedPage();
  if(!d.running)await checkNewUpdates();
  if(d.running)feedTimer=setTimeout(()=>{if(tab==='feed'&&mode===feedMode)loadFeed()},1500);
 }catch(e){if(token===feedToken)$('feedNotice').textContent='同步失败，保留已加载记录：'+e.message;}
}
let feedLoadArmed=false,feedScrollFrame=null;
function maybeLoadFeed(){if(feedLoadArmed&&tab==='feed'&&!feedBusy&&!feedWaiting&&!feedPageError&&$('feedMore').getBoundingClientRect().top<window.innerHeight+300){feedLoadArmed=false;loadFeedPage()}}
function armFeed(){if(tab==='feed'&&!feedBusy&&!feedWaiting){feedLoadArmed=true;requestAnimationFrame(maybeLoadFeed)}}
window.addEventListener('wheel',e=>{if(e.deltaY>0&&!e.target.closest('#drawer,.day-list'))armFeed()},{passive:true});
let touchY=null;window.addEventListener('touchstart',e=>{touchY=e.touches[0]?.clientY},{passive:true});
window.addEventListener('touchmove',e=>{const y=e.touches[0]?.clientY;if(touchY!==null&&y<touchY)armFeed();touchY=y},{passive:true});
window.addEventListener('keydown',e=>{if(!e.defaultPrevented&&['PageDown','End','ArrowDown',' '].includes(e.key)&&!e.target.closest('input,textarea,button'))armFeed()});
window.addEventListener('pointerdown',e=>{if(e.clientX>=document.documentElement.clientWidth)armFeed()},{passive:true});
window.addEventListener('scroll',()=>{if(tab==='feed'&&!feedScrollFrame)feedScrollFrame=requestAnimationFrame(()=>{feedScrollFrame=null;renderFeedRows();maybeLoadFeed()})},{passive:true});
window.addEventListener('resize',()=>renderFeedRows());
let notificationBusy=false;
async function checkNewUpdates(){
 if(notificationBusy||!stateReady)return;notificationBusy=true;
 try{
  const mode=feedMode,d=await localApi('/api/feed/latest?mode='+mode);if(mode!==feedMode||!d.date)return;
  const key='af_updates_'+mode,old=updateBaselines[mode];
  const newer=old&&d.keys.length>0&&(d.date>old.date||d.date===old.date&&d.keys.some(k=>!old.keys.includes(k)));
  if(!old||tab==='feed'){updateBaselines[mode]=d;save(key,d);uiSetting('update_baseline_'+mode,d);$('dot').hidden=true;}
  else if(newer)$('dot').hidden=false;
 }catch(e){console.warn('新动态检查失败：',e.message)}finally{notificationBusy=false}
}
// Poll current-source synchronization outside the feed; historical paging is never a notification source.
setInterval(async()=>{if(!stateReady||document.hidden)return;try{if(tab!=='feed')await localApi('/api/feed?mode='+feedMode);await checkNewUpdates()}catch{}},60000);
function renderHistory(){
 const items=Object.entries(history).sort((a,b)=>b[1].at-a[1].at);
 $('records').innerHTML=items.map(([key,h])=>`<div class="entry"><img src="${escapeHtml(image(h.anime))}" alt=""><div class="grow"><b>${escapeHtml(name(h.anime))}</b><p>第 ${h.episode} 集 · ${Math.floor(h.seconds/60)} 分钟 · ${new Date(h.at).toLocaleString('zh-CN')}</p><small>${h.source==='local-file'?'本地播放 · 自动保存 · '+escapeHtml(h.media?.name||''):'手动记录 · 已保存到本机'}</small></div><button data-open="${escapeHtml(key)}">${h.source==='local-file'?'继续观看':'恢复进度'}</button><button data-delete="${escapeHtml(key)}">删除</button></div>`).join('')||'<p class="muted">还没有观看记录。</p>';
 $('records').querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{const h=history[b.dataset.open];await openDetail(h.anime.id,{number:h.episode,page_offset:h.page_offset});if($('episodeInput')){$('episodeInput').value=h.episode;$('minutesInput').value=(h.seconds/60).toFixed(1)}if(h.source==='local-file')$('playLocal')?.click()});
 $('records').querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await persist({op:'delete_history',key:b.dataset.delete});renderHistory()}catch(e){alert('删除未保存：'+e.message);b.disabled=false}});
}
function switchTab(next,activate=true){
 tab=next;save('af_ui_tab',tab);uiSetting('ui_tab',tab);document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
 ['library','feed','history'].forEach(k=>$(k).hidden=k!==tab);$('heading').textContent={library:'动漫资料库',feed:'更新动态',history:'历史记录'}[tab];
 $('subtitle').textContent={library:'发现每一季的精彩动画',feed:'关注动漫的播出记录与日程',history:'继续播放与恢复每一集的观看进度'}[tab];
 if(tab==='feed'&&activate){renderFeed();checkNewUpdates();if(feedWaiting&&!feedBusy)loadFeedPage()}if(tab==='history')renderHistory();
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
document.querySelectorAll('[data-feed]').forEach(b=>b.onclick=()=>{feedMode=b.dataset.feed;save('af_ui_feed_mode',feedMode);uiSetting('ui_feed_mode',feedMode);++feedToken;feedData=null;resetFeed();window.scrollTo(0,0);document.querySelectorAll('[data-feed]').forEach(x=>x.classList.toggle('chosen',x===b));$('dot').hidden=true;renderFeed()});
["year","season"].forEach(id=>$(id).onchange=()=>load());["format","region"].forEach(id=>$(id).onchange=()=>{page=1;renderCards()});$("genre").oninput=()=>{page=1;renderCards()};$("search").oninput=()=>{page=1;renderCards()};$("reload").onclick=()=>load(true,true);$("more").onclick=()=>{page++;renderCards()};$('theme').onclick=async()=>{try{await persist({op:'setting',key:'dark',value:!document.body.classList.contains('dark')})}catch(e){alert('主题设置未保存：'+e.message)}};
$('sort').onchange=()=>{page=1;renderCards();loadUpdateSort()};
$('feedRefresh').onclick=()=>loadFeed(false,true);$('feedMore').onclick=()=>loadFeed(true);
document.querySelectorAll('[data-feed]').forEach(x=>x.classList.toggle('chosen',x.dataset.feed===feedMode));
switchTab(tab,false);
initState().then(()=>{switchTab(tab);checkNewUpdates()});load();
