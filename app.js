const STORE_KEY = 'fitness-calendar-v3';
const ASSET_BASE = 'https://cdn.jsdelivr.net/npm/@bryllim/workout-guide@1.0.0/';
const TYPE_NAMES = {
  'Functional Strength Training': ['功能性力量', 'strength'], 'Traditional Strength Training': ['传统力量', 'strength'],
  'Core Training': ['核心训练', 'strength'], Elliptical: ['椭圆机', 'cardio'], Cycling: ['骑行', 'cardio'],
  Walking: ['步行', 'cardio'], Running: ['跑步', 'cardio'], Climbing: ['攀岩', 'strength'],
  Swimming: ['游泳', 'cardio'], Rowing: ['划船', 'cardio'], Hiking: ['徒步', 'cardio'],
  'High Intensity Interval Training': ['HIIT', 'cardio'], 'Mind and Body': ['身心训练', 'mobility'], Yoga: ['瑜伽', 'mobility']
};
const MUSCLE_ZH = {Chest:'胸',Shoulders:'肩',Back:'背',Lats:'背阔肌',Biceps:'肱二头肌',Triceps:'肱三头肌',Quads:'股四头肌',Glutes:'臀',Hamstrings:'腿后侧',Core:'核心',Calves:'小腿','Upper Back':'上背','Lower Back':'下背','Rear Delts':'后束',Forearms:'前臂',Mobility:'活动度',Legs:'腿',Hips:'髋'};

let state = loadState();
let currentMonth = new Date();
currentMonth.setDate(1);
let exerciseManifest = [];
let editingExercises = [];
let exerciseTarget = { type: 'workout', id: null };
let selectedScreenshot = null;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const uid = (prefix='id') => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function loadState(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || freshState(); } catch { return freshState(); }
}
function freshState(){ return {version:1,seeded:false,workouts:[],sleep:{},templates:[],sources:[]}; }
function saveState(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2200); }

async function init(){
  bindNavigation(); bindCalendarControls(); bindWorkoutForm(); bindExerciseLibrary(); bindImports(); bindTemplateActions();
  await Promise.all([loadExercises(), seedFromExistingCsv()]);
  renderAll();
}

async function seedFromExistingCsv(){
  if(state.seeded && state.sources.length) return;
  try{
    const [calendarResponse,dailyResponse]=await Promise.all([fetchAvailable(['./data/calendar.csv','../reports/calendar_since_2026-03-01.csv']),fetchAvailable(['./data/daily_metrics.csv','../reports/latest_2026-08-18_daily_metrics.csv'])]);
    if(!calendarResponse) throw new Error('CSV unavailable');
    const rows=parseCsv(await calendarResponse.text());
    for(const row of rows){
      if(row.sleep_hours) state.sleep[row.date]={hours:Number(row.sleep_hours),score:row.custom_sleep_score_0_100?Number(row.custom_sleep_score_0_100):null,ranges:row.sleep_ranges||'',source:'apple_xml'};
      if(!row.workouts) continue;
      for(const text of row.workouts.split(' | ')){
        const m=text.match(/^(.+?)\s+(\d{2}:\d{2})-(\d{2}:\d{2})，([\d.]+)分钟，([\d.]+)kcal(?:，([\d.]+)km)?/);
        if(!m) continue;
        const mapped=TYPE_NAMES[m[1]]||[m[1],'cardio'];
        state.workouts.push({id:uid('xml'),date:row.date,name:mapped[0],originalType:m[1],category:mapped[1],status:'completed',start:m[2],duration:Math.round(Number(m[4])),calories:Math.round(Number(m[5])),distance:m[6]?Number(m[6]):null,workoutCount:1,location:'',exercises:[],notes:'',source:'apple_xml',sourceStatus:'reconciled'});
      }
    }
    if(dailyResponse){
      for(const row of parseCsv(await dailyResponse.text())){
        if(row.sleep_hours && Number(row.sleep_hours)>0 && !state.sleep[row.date]) state.sleep[row.date]={hours:Number(row.sleep_hours),score:row.sleep_score?Number(row.sleep_score):null,ranges:'',source:'apple_xml_summary'};
        const count=Number(row.workout_count)||0;
        if(count>0 && !state.workouts.some(w=>w.date===row.date)) state.workouts.push({id:uid('summary'),date:row.date,name:count>1?`${count}项训练`:'训练',originalType:'Aggregate',category:'cardio',status:'completed',start:'',duration:Math.round(Number(row.workout_minutes)||0),calories:Math.round(Number(row.workout_energy_kcal)||0),distance:null,workoutCount:count,location:'',exercises:[],notes:'每日汇总数据，待下次 XML 导入后补齐项目和时刻。',source:'apple_xml_summary',sourceStatus:'summary_pending_detail'});
      }
    }
    state.sources.unshift({id:uid('source'),date:new Date().toISOString(),kind:'Apple Health XML',detail:`历史日历数据 · ${state.workouts.length}条训练`,status:'已导入'});
    state.seeded=true; saveState();
  }catch(error){ console.warn(error); state.seeded=true; saveState(); }
}

async function fetchAvailable(paths){for(const path of paths){try{const response=await fetch(path);if(response.ok)return response;}catch{}}return null;}

function parseCsv(text){
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"' && quoted && text[i+1]==='"'){cell+='"';i++;}
    else if(c==='"') quoted=!quoted;
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);} const headers=rows.shift()||[];
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}

async function loadExercises(){
  try{ exerciseManifest=await (await fetch(`${ASSET_BASE}manifest.json`)).json(); populateExerciseFilters(); }
  catch{ exerciseManifest=[]; }
}

function bindNavigation(){
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
}
function showView(name){
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active')); $(`${name}View`).classList.add('active');
  const titles={calendar:['训练日志',monthTitle()],today:['当日安排','今日训练'],templates:['训练计划','力量模板'],imports:['数据中心','导入与对账']};
  $('viewEyebrow').textContent=titles[name][0]; $('viewTitle').textContent=titles[name][1]; $('monthControls').style.display=name==='calendar'?'flex':'none';
  if(name==='today') renderToday(); if(name==='templates') renderTemplates(); if(name==='imports') renderSourceLog();
}
function bindCalendarControls(){
  $('prevMonth').onclick=()=>{currentMonth.setMonth(currentMonth.getMonth()-1);renderCalendar();};
  $('nextMonth').onclick=()=>{currentMonth.setMonth(currentMonth.getMonth()+1);renderCalendar();};
  $('todayBtn').onclick=()=>{currentMonth=new Date();currentMonth.setDate(1);renderCalendar();};
  $('newWorkoutBtn').onclick=()=>openWorkoutDialog();
  $('exportIcsBtn').onclick=exportIcs;
  $('closeSyncGuide').onclick=()=>$('syncGuideDialog').close();
  $('finishSyncGuide').onclick=()=>$('syncGuideDialog').close();
  $('closeDayDialog').onclick=()=>$('dayDialog').close();
}

function monthTitle(){return `${currentMonth.getFullYear()} 年${currentMonth.getMonth()+1}月`;}
function renderAll(){renderCalendar();renderToday();renderTemplates();renderSourceLog();}
function renderCalendar(){
  $('viewTitle').textContent=monthTitle(); const grid=$('calendarGrid'); grid.innerHTML='';
  const y=currentMonth.getFullYear(),m=currentMonth.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
  const today=dateKey(new Date());
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const key=dateKey(d),items=state.workouts.filter(w=>w.date===key),sleep=state.sleep[key];
    const cell=document.createElement('div'); cell.className=`day-cell${d.getMonth()!==m?' outside':''}${key===today?' today':''}`;
    let html=`<div class="day-number"><span></span><strong>${d.getDate()}</strong></div>`;
    if(sleep) html+=`<div class="sleep-pill"><i></i>${sleep.hours.toFixed(1)}h${sleep.score?` · ${sleep.score}分`:''}</div>`;
    items.slice(0,3).forEach(w=>html+=`<div class="event-pill ${w.category} ${w.status==='planned'?'planned':''}"><b>${esc(w.name)}</b><time>${w.duration?`${w.duration}m`:w.start||''}</time></div>`);
    if(items.length>3) html+=`<div class="more-events">+${items.length-3}条</div>`;
    cell.innerHTML=html; cell.onclick=()=>openDay(key); grid.appendChild(cell);
  }
  const monthItems=state.workouts.filter(w=>{const d=new Date(`${w.date}T00:00:00`);return d.getFullYear()===y&&d.getMonth()===m&&w.status==='completed';});
  $('monthWorkoutCount').textContent=monthItems.reduce((a,w)=>a+(w.workoutCount||1),0); $('monthMinutes').textContent=Math.round(monthItems.reduce((a,w)=>a+(w.duration||0),0)); $('monthCalories').textContent=Math.round(monthItems.reduce((a,w)=>a+(w.calories||0),0)).toLocaleString();
  const sleeps=Object.entries(state.sleep).filter(([k])=>k.startsWith(`${y}-${pad(m+1)}`)).map(([,v])=>v.hours).filter(Boolean); $('monthSleep').textContent=sleeps.length?(sleeps.reduce((a,b)=>a+b,0)/sleeps.length).toFixed(1):'--';
}

function openDay(key){
  const date=new Date(`${key}T12:00:00`),items=state.workouts.filter(w=>w.date===key),sleep=state.sleep[key];
  $('dayDialogTitle').textContent=`${date.getMonth()+1}月${date.getDate()}日`;
  let html=sleep?`<div class="day-detail-sleep"><strong>睡眠 ${sleep.hours.toFixed(1)}小时${sleep.score?` · 睡眠状态分 ${sleep.score}`:''}</strong><p>${esc(sleep.ranges||'已从 Apple Health 导入')}</p></div>`:'<div class="day-detail-sleep"><strong>无睡眠数据</strong></div>';
  if(!items.length) html+='<div class="empty-state">当天没有训练记录</div>';
  items.forEach(w=>{html+=`<div class="day-session"><div class="day-session-head"><div><h3>${esc(w.name)}</h3><span class="data-badge ${w.sourceStatus||''}">${sourceLabel(w)}</span></div><button class="secondary edit-workout" data-id="${w.id}">编辑</button></div><p>${w.start?`${w.start} · `:''}${w.duration||0}分钟 · ${w.calories||0} kcal${w.location?` · ${esc(w.location)}`:''}</p>${w.exercises?.length?`<p>${w.exercises.map(x=>esc(x.name)).join(' · ')}</p>`:''}</div>`;});
  $('dayDialogContent').innerHTML=html; $('dayDialogContent').querySelectorAll('.edit-workout').forEach(b=>b.onclick=()=>{ $('dayDialog').close(); openWorkoutDialog(b.dataset.id);}); $('dayDialog').showModal();
}
function sourceLabel(w){return w.sourceStatus==='pending_xml'?'截图待 XML 补齐':w.sourceStatus==='summary_pending_detail'?'历史汇总，待 XML 补齐':w.source==='apple_xml'?'Apple Health XML':w.status==='planned'?'训练计划':'手工记录';}

function bindWorkoutForm(){
  $('workoutCategory').onchange=()=>toggleStrengthEditor(); $('addExerciseBtn').onclick=()=>openExercisePicker({type:'workout'});
  $('workoutForm').addEventListener('submit',e=>{e.preventDefault();saveWorkout();});
}
function openWorkoutDialog(id=null,preset={}){
  const w=id?state.workouts.find(x=>x.id===id):null; $('workoutDialogTitle').textContent=w?'编辑训练':'新增训练'; $('workoutId').value=w?.id||'';
  $('workoutStatus').value=w?.status||preset.status||'planned'; $('workoutCategory').value=w?.category||preset.category||'strength'; $('workoutName').value=w?.name||preset.name||''; $('workoutLocation').value=w?.location||'';
  $('workoutDate').value=w?.date||preset.date||dateKey(new Date()); $('workoutStart').value=w?.start||''; $('workoutDuration').value=w?.duration||''; $('workoutCalories').value=w?.calories||''; $('workoutNotes').value=w?.notes||'';
  editingExercises=structuredClone(w?.exercises||preset.exercises||[]); renderExerciseEditor();toggleStrengthEditor();$('workoutDialog').showModal();
}
function toggleStrengthEditor(){$('strengthEditor').classList.toggle('hidden',$('workoutCategory').value!=='strength');}
function saveWorkout(){
  const id=$('workoutId').value||uid('manual'),existing=state.workouts.find(x=>x.id===id);
  const next={...existing,id,status:$('workoutStatus').value,category:$('workoutCategory').value,name:$('workoutName').value.trim(),location:$('workoutLocation').value.trim(),date:$('workoutDate').value,start:$('workoutStart').value,duration:Number($('workoutDuration').value)||0,calories:Number($('workoutCalories').value)||0,notes:$('workoutNotes').value.trim(),exercises:$('workoutCategory').value==='strength'?structuredClone(editingExercises):[],source:existing?.source||'manual',sourceStatus:existing?.sourceStatus||'manual'};
  if(existing) Object.assign(existing,next); else state.workouts.push(next); saveState();$('workoutDialog').close();renderAll();toast('训练已保存');
}
function renderExerciseEditor(){
  const host=$('exerciseEditorList'); if(!editingExercises.length){host.innerHTML='<div class="empty-state">尚未添加动作</div>';return;}
  host.innerHTML=editingExercises.map((ex,ei)=>`<div class="editor-exercise"><img src="${ASSET_BASE}${ex.frame}" alt=""><div><h4>${esc(ex.name)}</h4><p>${esc(ex.primaryMuscle||'')} · ${esc(ex.equipment||'')}</p></div><button type="button" class="remove-exercise" data-ei="${ei}">×</button><div class="set-table">${(ex.sets||[]).map((s,si)=>`<div class="set-row"><span>${si+1}</span><input data-ei="${ei}" data-si="${si}" data-field="weight" type="number" placeholder="kg" value="${s.weight??''}"><input data-ei="${ei}" data-si="${si}" data-field="reps" type="number" placeholder="次数" value="${s.reps??''}"><button type="button" class="tiny-btn remove-set" data-ei="${ei}" data-si="${si}">×</button></div>`).join('')}<button type="button" class="tiny-btn add-set" data-ei="${ei}">+添加一组</button></div></div>`).join('');
  host.querySelectorAll('input[data-field]').forEach(i=>i.oninput=()=>editingExercises[+i.dataset.ei].sets[+i.dataset.si][i.dataset.field]=i.value===''?null:Number(i.value));
  host.querySelectorAll('.remove-exercise').forEach(b=>b.onclick=()=>{editingExercises.splice(+b.dataset.ei,1);renderExerciseEditor();});
  host.querySelectorAll('.add-set').forEach(b=>b.onclick=()=>{editingExercises[+b.dataset.ei].sets.push({weight:null,reps:null});renderExerciseEditor();});
  host.querySelectorAll('.remove-set').forEach(b=>b.onclick=()=>{editingExercises[+b.dataset.ei].sets.splice(+b.dataset.si,1);renderExerciseEditor();});
}

function bindExerciseLibrary(){ $('closeExerciseDialog').onclick=()=>$('exerciseDialog').close(); $('exerciseSearch').oninput=renderExerciseLibrary; $('muscleFilter').onchange=renderExerciseLibrary; $('equipmentFilter').onchange=renderExerciseLibrary; }
function populateExerciseFilters(){
  const muscles=[...new Set(exerciseManifest.map(x=>x.primaryMuscle))].sort(),equipment=[...new Set(exerciseManifest.map(x=>x.equipment))].sort();
  $('muscleFilter').innerHTML='<option value="">全部肌群</option>'+muscles.map(x=>`<option value="${esc(x)}">${MUSCLE_ZH[x]||x}</option>`).join('');
  $('equipmentFilter').innerHTML='<option value="">全部器械</option>'+equipment.map(x=>`<option>${esc(x)}</option>`).join('');
}
function openExercisePicker(target){exerciseTarget=target;$('exerciseSearch').value='';renderExerciseLibrary();$('exerciseDialog').showModal();}
function renderExerciseLibrary(){
  const q=$('exerciseSearch').value.toLowerCase(),muscle=$('muscleFilter').value,equipment=$('equipmentFilter').value;
  const rows=exerciseManifest.filter(x=>(!q||`${x.name} ${x.primaryMuscle} ${x.equipment}`.toLowerCase().includes(q))&&(!muscle||x.primaryMuscle===muscle)&&(!equipment||x.equipment===equipment)).slice(0,80);
  $('exerciseLibrary').innerHTML=rows.map(x=>`<button class="exercise-card" data-slug="${x.slug}"><img loading="lazy" src="${ASSET_BASE}${x.frames[0].path}" alt="${esc(x.name)}"><strong>${esc(x.name)}</strong><small>${MUSCLE_ZH[x.primaryMuscle]||x.primaryMuscle} · ${esc(x.equipment)}</small></button>`).join('');
  $('exerciseLibrary').querySelectorAll('.exercise-card').forEach(b=>b.onclick=()=>addExercise(b.dataset.slug));
}
function exerciseRecord(x){return {slug:x.slug,name:x.name,primaryMuscle:x.primaryMuscle,equipment:x.equipment,frame:x.frames[0].path,sets:[{weight:null,reps:null},{weight:null,reps:null},{weight:null,reps:null}]};}
function addExercise(slug){const x=exerciseManifest.find(e=>e.slug===slug);if(!x)return;if(exerciseTarget.type==='template'){const t=state.templates.find(t=>t.id===exerciseTarget.id);t.exercises.push(exerciseRecord(x));saveState();renderTemplates();toast(`已加入 ${x.name}`);}else{editingExercises.push(exerciseRecord(x));renderExerciseEditor();$('exerciseDialog').close();}}

function bindTemplateActions(){
  $('newTemplateBtn').onclick=()=>{$('templateName').value='';$('templateDialog').showModal();};
  $('templateForm').onsubmit=e=>{e.preventDefault();const name=$('templateName').value.trim();if(!name)return;const t={id:uid('template'),name,exercises:[]};state.templates.push(t);saveState();renderTemplates();$('templateDialog').close();openExercisePicker({type:'template',id:t.id});};
  $('startFromTemplateBtn').onclick=()=>{if(!state.templates.length){showView('templates');toast('请先建立一个力量模板');return;}startTemplate(state.templates[0].id);};
}
function renderTemplates(){
  const host=$('templateGrid');if(!state.templates.length){host.innerHTML='<div class="empty-state" style="grid-column:1/-1">还没有力量模板。新建后，可从 302 个动作中组合今日训练。</div>';return;}
  host.innerHTML=state.templates.map(t=>`<article class="template-card"><p class="eyebrow">${t.exercises.length}个动作</p><h3>${esc(t.name)}</h3><ul>${t.exercises.slice(0,6).map(x=>`<li>${esc(x.name)} · ${x.sets.length}组</li>`).join('')||'<li>尚未添加动作</li>'}</ul><div class="template-actions"><button class="primary start-template" data-id="${t.id}">安排今天</button><button class="secondary add-template-exercise" data-id="${t.id}">+动作</button><button class="secondary delete-template" data-id="${t.id}">删除</button></div></article>`).join('');
  host.querySelectorAll('.start-template').forEach(b=>b.onclick=()=>startTemplate(b.dataset.id));host.querySelectorAll('.add-template-exercise').forEach(b=>b.onclick=()=>openExercisePicker({type:'template',id:b.dataset.id}));host.querySelectorAll('.delete-template').forEach(b=>b.onclick=()=>{if(confirm('删除这个模板？')){state.templates=state.templates.filter(t=>t.id!==b.dataset.id);saveState();renderTemplates();}});
}
function startTemplate(id){const t=state.templates.find(x=>x.id===id);if(!t)return;openWorkoutDialog(null,{name:t.name,category:'strength',status:'planned',date:dateKey(new Date()),exercises:structuredClone(t.exercises)});}

function renderToday(){
  const today=dateKey(new Date()),date=new Date();$('todayDateLabel').textContent=`${date.getMonth()+1}月${date.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][date.getDay()]}`;
  const sleep=state.sleep[today];$('todayRecovery').textContent=sleep?`睡眠 ${sleep.hours.toFixed(1)} 小时${sleep.score?` · 睡眠状态分 ${sleep.score}`:''}`:'尚无今日睡眠数据';
  const items=state.workouts.filter(w=>w.date===today),host=$('todaySessions');host.innerHTML=items.length?items.map(w=>`<article class="session-card"><p class="eyebrow">${w.status==='planned'?'计划':'已完成'}</p><h3>${esc(w.name)}</h3><p>${w.duration||0}分钟 · ${w.exercises?.length||0}个动作 · ${w.calories||0} kcal</p><button class="secondary today-edit" data-id="${w.id}">${w.status==='planned'?'开始/记录':'查看详情'}</button></article>`).join(''):'<div class="empty-state">今天还没有安排训练</div>';host.querySelectorAll('.today-edit').forEach(b=>b.onclick=()=>openWorkoutDialog(b.dataset.id));
}

function bindImports(){
  bindDrop('screenshotDrop','screenshotInput',handleScreenshot);bindDrop('xmlDrop','xmlInput',handleXml);
}
function bindDrop(zoneId,inputId,handler){const zone=$(zoneId),input=$(inputId);input.onchange=()=>input.files[0]&&handler(input.files[0]);['dragenter','dragover'].forEach(n=>zone.addEventListener(n,e=>{e.preventDefault();zone.classList.add('dragover');}));['dragleave','drop'].forEach(n=>zone.addEventListener(n,e=>{e.preventDefault();zone.classList.remove('dragover');}));zone.addEventListener('drop',e=>e.dataTransfer.files[0]&&handler(e.dataTransfer.files[0]));}
async function handleScreenshot(file){
  selectedScreenshot=file;const out=$('screenshotResult');out.classList.remove('hidden');out.innerHTML=`<strong>${esc(file.name)}</strong><p>正在加载本地 OCR 模型并识别…</p>`;
  try{
    if(!window.Tesseract)throw new Error('OCR 组件未加载');
    const result=await window.Tesseract.recognize(file,'chi_sim+eng',{logger:m=>{if(m.progress)out.querySelector('p').textContent=`${m.status} · ${Math.round(m.progress*100)}%`;}});
    const parsed=parseWorkoutScreenshot(result.data.text);renderScreenshotReview(parsed,result.data.text,file);
  }catch(error){renderScreenshotReview({date:dateKey(new Date()),name:'',category:'strength',duration:'',calories:'',start:''},'',file,`自动识别未完成：${error.message}。可以手动确认字段。`);}
}
function parseWorkoutScreenshot(text){
  const flat=text.replace(/\s+/g,' '),duration=flat.match(/(\d{1,3})\s*(?:分钟|min)/i),cal=flat.match(/(\d{2,4})\s*(?:千卡|kcal|CAL)/i),time=flat.match(/([01]?\d|2[0-3]):[0-5]\d/),date=flat.match(/(20\d{2})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
  let name='功能性力量训练',category='strength';for(const [needle,n,c] of [['椭圆','椭圆机','cardio'],['骑行','骑行','cardio'],['步行','步行','cardio'],['跑步','跑步','cardio'],['力量','功能性力量','strength'],['游泳','游泳','cardio']])if(flat.includes(needle)){name=n;category=c;break;}
  return {date:date?`${date[1]}-${pad(date[2])}-${pad(date[3])}`:dateKey(new Date()),name,category,duration:duration?.[1]||'',calories:cal?.[1]||'',start:time?.[0]||''};
}
function renderScreenshotReview(p,raw,file,warning=''){
  const out=$('screenshotResult');out.innerHTML=`${warning?`<p style="color:var(--yellow)">${esc(warning)}</p>`:''}<div class="form-grid"><label><span>运动</span><input id="shotName" value="${esc(p.name)}"></label><label><span>类别</span><select id="shotCategory"><option value="strength" ${p.category==='strength'?'selected':''}>力量</option><option value="cardio" ${p.category==='cardio'?'selected':''}>有氧</option></select></label><label><span>日期</span><input id="shotDate" type="date" value="${p.date}"></label><label><span>开始</span><input id="shotStart" type="time" value="${p.start}"></label><label><span>时长（分钟）</span><input id="shotDuration" type="number" value="${p.duration}"></label><label><span>活动消耗</span><input id="shotCalories" type="number" value="${p.calories}"></label></div><button class="primary" id="confirmScreenshot" style="margin-top:12px">确认为待 XML 补齐记录</button>`;
  $('confirmScreenshot').onclick=async()=>{const hash=await fileHash(file);await storeScreenshot(hash,file);state.workouts.push({id:uid('shot'),date:$('shotDate').value,name:$('shotName').value||'未命名训练',category:$('shotCategory').value,status:'completed',start:$('shotStart').value,duration:Number($('shotDuration').value)||0,calories:Number($('shotCalories').value)||0,location:'',exercises:[],notes:'',source:'screenshot',sourceStatus:'pending_xml',screenshot:{hash,name:file.name,ocrText:raw,importedAt:new Date().toISOString()}});state.sources.unshift({id:uid('source'),date:new Date().toISOString(),kind:'训练截图',detail:file.name,status:'待 XML 补齐'});saveState();renderAll();out.innerHTML='<strong>截图记录已保存</strong><p>下次导入 XML 时会自动匹配并补齐。</p>';toast('已添加截图记录');};
}
async function fileHash(file){const data=await file.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function storeScreenshot(id,file){return new Promise((resolve,reject)=>{const req=indexedDB.open('fitness-calendar-images',1);req.onupgradeneeded=()=>req.result.createObjectStore('screenshots');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const tx=req.result.transaction('screenshots','readwrite');tx.objectStore('screenshots').put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);};});}

function handleXml(file){
  const progress=$('xmlProgress'),result=$('xmlResult');progress.classList.remove('hidden');result.classList.add('hidden');const worker=new Worker('./xml-worker.js',{type:'module'});
  worker.onmessage=e=>{const msg=e.data;if(msg.type==='progress'){$('xmlProgressBar').style.width=`${msg.percent}%`;$('xmlProgressText').textContent=`正在解析 ${msg.percent}% · ${msg.workouts}条训练 · ${msg.sleepRecords}条睡眠分段`;}else if(msg.type==='done'){mergeXml(msg.data,file);worker.terminate();}else if(msg.type==='error'){result.classList.remove('hidden');result.textContent=`解析失败：${msg.message}`;worker.terminate();}};worker.postMessage({file});
}
function mergeXml(data,file){
  let merged=0,added=0;for(const incoming of data.workouts){const candidate=state.workouts.find(w=>w.sourceStatus==='pending_xml'&&workoutMatch(w,incoming));if(candidate){Object.assign(candidate,{date:incoming.date,name:TYPE_NAMES[incoming.originalType]?.[0]||candidate.name,start:incoming.start,duration:incoming.duration,calories:incoming.calories,distance:incoming.distance,source:'apple_xml+screenshot',sourceStatus:'reconciled',xmlId:incoming.xmlId});merged++;}else if(!state.workouts.some(w=>w.xmlId&&w.xmlId===incoming.xmlId)){state.workouts.push({...incoming,id:uid('xml'),name:TYPE_NAMES[incoming.originalType]?.[0]||incoming.originalType,category:TYPE_NAMES[incoming.originalType]?.[1]||'cardio',status:'completed',location:'',exercises:[],notes:'',source:'apple_xml',sourceStatus:'reconciled'});added++;}}
  for(const [date,sleep] of Object.entries(data.sleep))state.sleep[date]={...sleep,source:'apple_xml'};
  state.sources.unshift({id:uid('source'),date:new Date().toISOString(),kind:'Apple Health XML',detail:`${file.name} · 新增${added}条 · 合并${merged}条 · 睡眠${Object.keys(data.sleep).length}天`,status:'已对账'});saveState();renderAll();$('xmlProgress').classList.add('hidden');$('xmlResult').classList.remove('hidden');$('xmlResult').innerHTML=`<strong>导入完成</strong><p>新增 ${added} 条训练，与截图合并 ${merged} 条，导入 ${Object.keys(data.sleep).length} 天睡眠。${data.exportDate?`<br>导出日期：${esc(data.exportDate)}`:''}</p>`;toast('Apple Health XML 已导入');
}
function workoutMatch(a,b){if(a.date!==b.date)return false;const ad=a.duration||0,bd=b.duration||0,calA=a.calories||0,calB=b.calories||0;const timeClose=!a.start||!b.start||Math.abs(toMinutes(a.start)-toMinutes(b.start))<=25;return timeClose&&Math.abs(ad-bd)<=15&&(!calA||!calB||Math.abs(calA-calB)<=120);}
function toMinutes(t){const [h,m]=t.split(':').map(Number);return h*60+m;}

function renderSourceLog(){const host=$('sourceLog');host.innerHTML=state.sources.length?state.sources.map(s=>`<div class="source-row"><span>${new Date(s.date).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><div><strong>${esc(s.kind)}</strong><br><span>${esc(s.detail)}</span></div><b>${esc(s.status)}</b></div>`).join(''):'<div class="empty-state">尚无导入记录</div>';}

function exportIcs(){
  const events=state.workouts.map(w=>{const start=(w.start||'09:00').replace(':','')+'00',startDate=w.date.replaceAll('-',''),end=new Date(`${w.date}T${w.start||'09:00'}:00`);end.setMinutes(end.getMinutes()+(w.duration||60));const endDate=`${end.getFullYear()}${pad(end.getMonth()+1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`;const title=`${w.status==='planned'?'计划｜':''}${w.name}${w.duration?`｜${w.duration}分钟`:''}`;const detail=[w.location&&`地点：${w.location}`,w.calories&&`活动消耗：${w.calories} kcal`,w.exercises?.length&&`动作：${w.exercises.map(x=>x.name).join('、')}`,`数据来源：${sourceLabel(w)}`].filter(Boolean).join('\\n');return ['BEGIN:VEVENT',`UID:${w.id}@fitness-calendar.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART:${startDate}T${start}`,`DTEND:${endDate}`,`SUMMARY:${icsEsc(title)}`,`DESCRIPTION:${icsEsc(detail)}`,w.location?`LOCATION:${icsEsc(w.location)}`:'','END:VEVENT'].filter(Boolean).join('\r\n');});
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fitness Calendar//ZH-CN','CALSCALE:GREGORIAN','X-WR-CALNAME:健身',...events,'END:VCALENDAR'].join('\r\n');const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='健身日历.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('syncState').textContent='已建立';$('syncGuideDialog').showModal();toast('日历文件已生成');
}
function icsEsc(v){return String(v).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}

init();
