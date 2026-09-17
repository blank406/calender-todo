const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
(async () => {
 const output = path.resolve('tests/visual-output'); fs.mkdirSync(output, {recursive:true});
 const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9337',`--user-data-dir=${path.join(output,'browser-profile')}`,'about:blank'], {stdio:'ignore', windowsHide:true});
 let socket;
 try {
  let tabs;
  for(let i=0;i<60;i++) { try { tabs=await (await fetch('http://127.0.0.1:9337/json')).json(); if(tabs.length) break; } catch {} await new Promise(r=>setTimeout(r,200)); }
  if(!tabs?.length) throw Error('Headless browser did not start');
  socket = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0; const pending=new Map();
  socket.onmessage=event=>{const m=JSON.parse(event.data); if(pending.has(m.id)){ const {resolve,reject}=pending.get(m.id); pending.delete(m.id); m.error?reject(Error(m.error.message)):resolve(m.result); }};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id; pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await send('Page.enable');
  await send('Page.navigate',{url:pathToFileURL(path.resolve('index.html')).href});
  for(let i=0;i<30;i++){if(await evaluate("document.readyState === 'complete' && !!document.querySelector('#calendar .date')"))break;await new Promise(r=>setTimeout(r,100));}
  for(let i=0;i<100;i++){if(await evaluate("!document.querySelector('#authFields').disabled"))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate("typeof globalThis.supabase?.createClient"),'function');
  assert.equal(await evaluate("document.querySelector('#authFields').disabled"),false);
  await evaluate(`(async()=>{
    const rows=[
      {id:'category-study',name:'공부',color:'#b879e8',user_id:'visual-user',created_at:'2026-01-01'},
      {id:'category-personal',name:'개인',color:'#f47f91',user_id:'visual-user',created_at:'2026-01-02'}
    ];
    const client={from(table){let single=false;const filters=[];const query={select(){return query},delete(){return query},eq(key,value){filters.push([key,value]);return query},order(){return query},single(){single=true;return query},then(resolve){if(table==='categories')return resolve({data:rows,error:null});const id=filters.find(([key])=>key==='id')?.[1];resolve({data:single?{id}:[],error:null})}};return query}};
    await calendarCategoryController.setSession(client,{id:'visual-user'});
  })()`);
  // Seed in-memory rows for disposable visual layout checks; persistence is tested separately.
  await evaluate(`currentYear=2026;currentMonth=7;selectedDate=new Date(2026,7,15);
    todos=Object.create(null);let visualId=0;
    for(const [day,categoryId,text] of [[3,'category-study','Java 공부하기'],[9,'category-personal','산책하기'],[15,'category-study','알고리즘 문제 풀기'],[15,'category-personal','책 읽기'],[18,'category-personal','과제 제출'],[22,'category-personal','운동하기']]){const todo_date='2026-08-'+String(day).padStart(2,'0');(todos[todo_date]||=[]).push({id:'visual-'+(++visualId),todo_date,text,completed:false,categoryId,user_id:'visual-user',created_at:'2026-01-01'});}
    todos['2026-08-09'][0].completed=true;todoReady=true;activeCategoryId=categories[0]?.id ?? null;showSelectedDate();renderCalendar();renderTodoAccess();`);
  const results=[];
  for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[1000,800],[900,700],[390,844]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   const result=await evaluate(`(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();const c=rect('#calendar'),p=rect('.calendar-section'),t=rect('.todo-section'),input=rect('.todo-input-wrap');return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,calendarFits:c.bottom<=p.bottom&&c.right<=p.right,inputFits:input.right<=t.right,sidebar:getComputedStyle(document.querySelector('.month-navigation')).display!=='none',days:document.querySelectorAll('#calendar .date').length}})()`);
   assert.equal(result.overflow,false); assert.equal(result.calendarFits,true);assert.equal(result.inputFits,true);assert.equal(result.days,31);
   results.push(result);
   const accountLayout=await evaluate(`(()=>{const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}},a=rect('#openAuthButton'),s=rect('#openSettingsButton'),p=rect('#manageCategoriesButton'),n=rect('#nextMonth');const apart=(x,y)=>x.right<=y.left||x.left>=y.right||x.bottom<=y.top||x.top>=y.bottom;return {ok:a.left>=0&&s.left>=0&&a.right<=innerWidth&&s.right<=innerWidth&&apart(a,s)&&apart(a,p)&&apart(a,n)&&apart(s,p)&&apart(s,n),a,s,p,n};})()`);
   assert.equal(accountLayout.ok,true,JSON.stringify({width,accountLayout}));
   await evaluate("document.querySelector('#deleteAllTodosButton').click()");
   const confirmation = await evaluate(`(()=>{const button=document.querySelector('#deleteAllTodosButton').getBoundingClientRect();const panel=document.querySelector('#deleteAllTodosConfirm').getBoundingClientRect();return {below:panel.top>=button.bottom,near:panel.top-button.bottom<12,fits:panel.left>=0&&panel.right<=innerWidth};})()`);
   assert.equal(confirmation.below,true);assert.equal(confirmation.near,true);assert.equal(confirmation.fits,true);
   await evaluate("document.querySelector('#cancelDeleteAllTodosButton').click();window.scrollTo(0,0)");
   await evaluate("document.querySelector('.todo-more').scrollIntoView({block:'center'})");
   await new Promise(resolve => setTimeout(resolve, 100));
   await evaluate("document.querySelector('.todo-more').click()");
   const menuPosition = await evaluate(`(()=>{const b=document.querySelector('.todo-more').getBoundingClientRect();const m=document.querySelector('#todoMenu').getBoundingClientRect();return {near:Math.abs(m.top-b.bottom-6)<2||Math.abs(b.top-m.bottom-6)<2,aligned:Math.abs(m.right-b.right)<2,fits:m.left>=0&&m.right<=innerWidth&&m.top>=0&&m.bottom<=innerHeight};})()`);
   assert.equal(menuPosition.near,true);assert.equal(menuPosition.aligned,true);assert.equal(menuPosition.fits,true);
   const menuShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`${width}x${height}-menu.png`),Buffer.from(menuShot.data,'base64'));
   await evaluate("document.querySelector('#todoMenu').hidePopover();window.scrollTo(0,0)");
   const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`${width}x${height}.png`),Buffer.from(shot.data,'base64'));
  }
  // Exercise real popovers and the relocated delete action.
  await evaluate("document.querySelector('.todo-more').click()");
  assert.equal(await evaluate("document.querySelector('#todoMenu').matches(':popover-open')"),true);
  await evaluate("document.querySelector('#deleteMenuTodoButton').click()");
  assert.equal(await evaluate("todos['2026-08-15'].length"),1);
  await evaluate("document.querySelector('#manageCategoriesButton').click()");
  assert.equal(await evaluate("document.querySelector('#categoryDialog').matches(':popover-open')"),true);
  await evaluate("document.querySelector('#categoryDialog').hidePopover();document.querySelector('#openAuthButton').click()");
  assert.equal(await evaluate("document.querySelector('#authDialog').open"),true);
  await evaluate("document.querySelector('#authModeButton').click()");
  assert.equal(await evaluate("document.querySelector('#authPassword').autocomplete"),'new-password');
  const authShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'auth-mobile.png'),Buffer.from(authShot.data,'base64'));
  await evaluate("document.querySelector('#closeAuthButton').click()");
  await evaluate("document.querySelector('#openSettingsButton').click();const select=document.querySelector('#fontPreference');select.value='concon';select.dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await evaluate("document.documentElement.dataset.appFont"),'concon');
  assert.equal(await evaluate("localStorage.getItem('calendarTodoFont')"),'concon');
  assert.equal(await evaluate("(async()=> (await document.fonts.load('16px \\\"온글잎 콘콘체\\\"')).length > 0)()"),true);
  await evaluate("(()=>{const positiveSelect=document.querySelector('#fontPreference');positiveSelect.value='positive';positiveSelect.dispatchEvent(new Event('change',{bubbles:true}))})()");
  assert.equal(await evaluate("document.documentElement.dataset.appFont"),'positive');
  assert.equal(await evaluate("localStorage.getItem('calendarTodoFont')"),'positive');
  assert.equal(await evaluate("(async()=> (await document.fonts.load('16px \\\"온글잎 긍정\\\"')).length > 0)()"),true);
  await send('Page.reload');
  for(let i=0;i<30;i++){if(await evaluate("document.readyState === 'complete' && document.documentElement.dataset.appFont === 'positive'"))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate("document.querySelector('#fontPreference').value"),'positive');
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2));
  await send('Browser.close');
 } finally { if(socket) socket.close();proc.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

