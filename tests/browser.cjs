const {chromium}=require('playwright');
const {spawn}=require('child_process');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const root=path.resolve(__dirname,'..');const qaFont=process.env.QA_FONT_PATH||'/workspace/scratch/77fa98c948d7/browser-tools/NotoSansSC.ttf';const tmp=fs.mkdtempSync('/tmp/animeflow-browser-');if(fs.existsSync(path.join(root,'data/cache.sqlite3')))fs.copyFileSync(path.join(root,'data/cache.sqlite3'),path.join(tmp,'cache.sqlite3'));if(fs.existsSync(path.join(root,'data/covers')))fs.symlinkSync(path.join(root,'data/covers'),path.join(tmp,'covers'));const server=spawn('python3',['server.py'],{cwd:root,env:{...process.env,ANIMEFLOW_DATA_DIR:tmp}});server.stdout?.resume();server.stderr?.resume();
 let b;
 try{
  await new Promise((resolve,reject)=>{let i=0; const timer=setInterval(async()=>{try{await fetch('http://127.0.0.1:5173/');clearInterval(timer);resolve()}catch{if(++i>40){clearInterval(timer);reject(Error('server unavailable'))}}},100)});
  b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());
  await p.goto('http://127.0.0.1:5173');
  if(fs.existsSync(qaFont)){const font=fs.readFileSync(qaFont).toString('base64');await p.addStyleTag({content:`@font-face{font-family:QACJK;src:url(data:font/ttf;base64,${font})}body,input,button,select{font-family:QACJK,sans-serif!important}`});await p.evaluate(()=>document.fonts.ready)}
  await p.selectOption('#year','2024');await p.selectOption('#season','WINTER');
  await p.waitForFunction(()=>document.querySelector('#notice').textContent.includes('本季度'),{},{timeout:180000});
  assert.equal(await p.locator('.card').count(),24);
  await p.click('#more');assert.equal(await p.locator('.card').count(),48);
  await p.selectOption('#sort','SCORE_DESC');
  const scores=await p.locator('.card .score').allTextContents();const nums=scores.map(s=>Number(s.replace('★','').trim()));assert(nums.every((n,i)=>!i||n<=nums[i-1]));
  await p.selectOption('#format','TV');assert((await p.locator('.card small').allTextContents()).every(x=>x.startsWith('TV')));
  await p.selectOption('#region','日本');assert(await p.locator('.card').count()>0);
  await p.fill('#genre','恋爱');assert(await p.locator('.card').count()>0);
  await p.fill('#search','我心里');assert.equal(await p.locator('.card').count(),1);
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('.poster img')).every(e=>e.complete&&e.naturalWidth>0),{},{timeout:60000});
  await p.screenshot({path:path.join(root,'evidence/library.png')});
  await p.locator('.card').click();await p.waitForSelector('#follow',{timeout:60000});
  await p.waitForFunction(()=>!document.querySelector('#episodeStatus').textContent.includes('正在'),{},{timeout:60000});
  assert((await p.locator('#detail h2').innerText()).includes('我心里'));
  assert(await p.locator('.episode-aired').count()>0);assert.equal(await p.locator('.episode-locked').count(),0);
  await p.waitForFunction(()=>!/(待定|正在补充)/.test(document.querySelector('#detailStudio').textContent),{},{timeout:90000});
  assert(!(await p.locator('#detailStudio').innerText()).includes('待定'));
  await p.screenshot({path:path.join(root,'evidence/detail.png')});
  await p.click('#follow');await p.waitForFunction(()=>document.querySelector('#follow').textContent.includes('已追番'));assert((await p.locator('#follow').innerText()).includes('已追番'));
  await p.locator('.episode-aired').first().click();await p.click('#saveProgress');await p.waitForFunction(()=>document.querySelector('#episodeStatus').textContent.includes('已保存到本机'));
  await p.click('#close');await p.locator('[data-tab="history"]').click();assert.equal(await p.locator('#records .entry').count(),1);
  await p.evaluate(()=>localStorage.clear());await p.reload();await p.waitForFunction(()=>document.querySelector('#storageStatus').textContent.includes('已保存'));await p.locator('[data-tab="history"]').click();assert.equal(await p.locator('#records .entry').count(),1);
  await p.locator('[data-delete]').click();await p.waitForFunction(()=>!document.querySelector('#records .entry'));assert.equal(await p.locator('#records .entry').count(),0);
  await p.click('#theme');await p.waitForFunction(()=>document.body.classList.contains('dark'));assert(await p.locator('body').evaluate(e=>e.classList.contains('dark')));
  const result={passed:errors.length===0,errors,checks:['full quarter renders','pagination 24 -> 48','score order','TV filter','Japan filter','romance tag filter','search beyond first page','detail','episode records','follow','SQLite history persists after localStorage cleared','delete history','theme'],images:await p.locator('.poster img').evaluateAll(es=>es.map(e=>({src:e.src,loaded:e.complete&&e.naturalWidth>0})))};
  fs.writeFileSync(path.join(root,'evidence/browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert.equal(errors.length,0);
 }finally{await b?.close();server.kill();fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
