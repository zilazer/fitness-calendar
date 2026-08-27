const WORKOUT_NAMES={
  HKWorkoutActivityTypeFunctionalStrengthTraining:'Functional Strength Training',
  HKWorkoutActivityTypeTraditionalStrengthTraining:'Traditional Strength Training',
  HKWorkoutActivityTypeCoreTraining:'Core Training',HKWorkoutActivityTypeElliptical:'Elliptical',
  HKWorkoutActivityTypeCycling:'Cycling',HKWorkoutActivityTypeWalking:'Walking',
  HKWorkoutActivityTypeRunning:'Running',HKWorkoutActivityTypeClimbing:'Climbing',
  HKWorkoutActivityTypeSwimming:'Swimming',HKWorkoutActivityTypeRowing:'Rowing',
  HKWorkoutActivityTypeHiking:'Hiking',HKWorkoutActivityTypeHighIntensityIntervalTraining:'High Intensity Interval Training',
  HKWorkoutActivityTypeYoga:'Yoga',HKWorkoutActivityTypeMindAndBody:'Mind and Body'
};
const SLEEP_VALUES=new Set(['HKCategoryValueSleepAnalysisAsleep','HKCategoryValueSleepAnalysisAsleepCore','HKCategoryValueSleepAnalysisAsleepDeep','HKCategoryValueSleepAnalysisAsleepREM']);

self.onmessage=async(event)=>{
  const file=event.data.file;
  try{
    const chunkSize=4*1024*1024,decoder=new TextDecoder(),workouts=[],sleepIntervals=[],stats={workouts:0,sleepRecords:0};
    let buffer='',offset=0,exportDate='';
    while(offset<file.size){
      const end=Math.min(offset+chunkSize,file.size),chunk=await file.slice(offset,end).arrayBuffer();
      buffer+=decoder.decode(chunk,{stream:end<file.size});
      const processed=consume(buffer,{workouts,sleepIntervals,stats,setExportDate:v=>exportDate=v});buffer=processed.rest;
      offset=end;
      self.postMessage({type:'progress',percent:Math.round(offset/file.size*100),workouts:stats.workouts,sleepRecords:stats.sleepRecords});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    consume(buffer,{workouts,sleepIntervals,stats,setExportDate:v=>exportDate=v},true);
    self.postMessage({type:'done',data:{exportDate,workouts,sleep:buildSleep(sleepIntervals)}});
  }catch(error){self.postMessage({type:'error',message:error?.message||String(error)});}
};

function consume(input,ctx,final=false){
  let buffer=input;
  while(buffer){
    const choices=[['export',buffer.indexOf('<ExportDate ')],['record',buffer.indexOf('<Record ')],['workout',buffer.indexOf('<Workout ')]] .filter(([,i])=>i>=0).sort((a,b)=>a[1]-b[1]);
    if(!choices.length)return {rest:final?'':buffer.slice(-80)};
    const [kind,index]=choices[0];if(index>0)buffer=buffer.slice(index);
    if(kind==='export'){
      const end=buffer.indexOf('>');if(end<0)return {rest:buffer};const attrs=parseAttrs(buffer.slice(0,end+1));ctx.setExportDate(attrs.value||'');buffer=buffer.slice(end+1);continue;
    }
    if(kind==='record'){
      const openEnd=buffer.indexOf('>');if(openEnd<0)return {rest:buffer};const opening=buffer.slice(0,openEnd+1);let elementEnd=openEnd+1;
      if(!/\/\s*>$/.test(opening)){const close=buffer.indexOf('</Record>',openEnd);if(close<0)return {rest:buffer};elementEnd=close+9;}
      const attrs=parseAttrs(opening);processRecord(attrs,ctx);buffer=buffer.slice(elementEnd);continue;
    }
    const close=buffer.indexOf('</Workout>');if(close<0)return {rest:buffer};const block=buffer.slice(0,close+10);processWorkout(block,ctx);buffer=buffer.slice(close+10);
  }
  return {rest:''};
}

function parseAttrs(tag){
  const attrs={};for(const match of tag.matchAll(/([\w:]+)="([^"]*)"/g))attrs[match[1]]=decodeXml(match[2]);return attrs;
}
function decodeXml(v){return v.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function isoDate(value){return value?.slice(0,10)||'';}
function parseAppleDate(value){if(!value)return NaN;return Date.parse(value.replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));}
function processRecord(attrs,ctx){
  if(attrs.type!=='HKCategoryTypeIdentifierSleepAnalysis'||!SLEEP_VALUES.has(attrs.value))return;
  const start=parseAppleDate(attrs.startDate),end=parseAppleDate(attrs.endDate);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return;
  ctx.sleepIntervals.push({start,end,date:isoDate(attrs.endDate),stage:attrs.value});ctx.stats.sleepRecords++;
}
function processWorkout(block,ctx){
  const opening=block.slice(0,block.indexOf('>')+1),attrs=parseAttrs(opening),startDate=attrs.startDate;if(!startDate)return;
  const originalType=WORKOUT_NAMES[attrs.workoutActivityType]||attrs.workoutActivityType?.replace('HKWorkoutActivityType','')||'训练';
  const duration=normalizeDuration(Number(attrs.duration)||0,attrs.durationUnit||'min');let calories=normalizeEnergy(Number(attrs.totalEnergyBurned)||0,attrs.totalEnergyBurnedUnit||'kcal'),distance=normalizeDistance(Number(attrs.totalDistance)||0,attrs.totalDistanceUnit||'km');
  for(const tag of block.matchAll(/<WorkoutStatistics\s+[^>]*\/?\s*>/g)){
    const stat=parseAttrs(tag[0]),sum=Number(stat.sum);if(!Number.isFinite(sum))continue;
    if(stat.type==='HKQuantityTypeIdentifierActiveEnergyBurned')calories=normalizeEnergy(sum,stat.unit);
    if(/Distance/.test(stat.type||''))distance=normalizeDistance(sum,stat.unit);
  }
  const startMs=parseAppleDate(startDate),endMs=parseAppleDate(attrs.endDate);const safeDuration=duration||((endMs-startMs)/60000)||0;
  ctx.workouts.push({xmlId:`${attrs.workoutActivityType}-${startDate}`,date:isoDate(startDate),originalType,start:startDate.slice(11,16),duration:Math.round(safeDuration),calories:Math.round(calories||0),distance:distance?Math.round(distance*100)/100:null});ctx.stats.workouts++;
}
function normalizeDuration(value,unit){if(unit==='s'||unit==='sec')return value/60;if(unit==='h'||unit==='hr')return value*60;return value;}
function normalizeEnergy(value,unit){if(/kJ/i.test(unit||''))return value/4.184;return value;}
function normalizeDistance(value,unit){if(unit==='m')return value/1000;if(unit==='mi')return value*1.609344;return value;}

function buildSleep(intervals){
  const byDate={};for(const interval of intervals)(byDate[interval.date]??=[]).push(interval);
  const result={};for(const [date,rows] of Object.entries(byDate)){
    rows.sort((a,b)=>a.start-b.start);const merged=[];for(const row of rows){const last=merged.at(-1);if(last&&row.start<=last.end)last.end=Math.max(last.end,row.end);else merged.push({start:row.start,end:row.end});}
    const hours=merged.reduce((sum,x)=>sum+(x.end-x.start)/3600000,0);if(hours<=0)continue;
    const score=Math.max(20,Math.min(100,Math.round(100-Math.abs(hours-7.5)*14)));
    const ranges=merged.map(x=>`${clock(x.start)}-${clock(x.end)}${new Date(x.start).getDate()!==new Date(x.end).getDate()?'+1天':''}`).join(' / ');
    result[date]={hours:Math.round(hours*100)/100,score,ranges,scoreKind:'custom_duration_based'};
  }
  return result;
}
function clock(ms){const d=new Date(ms);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
