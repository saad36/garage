const LEGACY_KEY='garageDataV1';
const DB_NAME='myGarageDB';
const DB_VERSION=1;
const DB_STORE='state';
const SCHEMA_VERSION=2;
const $=id=>document.getElementById(id);

const initial={
 settings:{allowance:101847,vRate:.20,eRate:.098,leaseStart:'2026-04-27',leaseEnd:'2030-04-27',leaseOdo:0},
 fuel:[],charge:[],mileage:[],maint:[],vehicles:[],customFuel:[],customCharge:[]
};

function cloneInitial(){return JSON.parse(JSON.stringify(initial));}
function newId(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9)}
function ensureIds(arr,prefix){arr.forEach(x=>{if(!x.id)x.id=newId(prefix)})}
function normalizeData(raw){
 const x=raw&&typeof raw==='object'?raw:cloneInitial();
 x.schemaVersion=SCHEMA_VERSION;
 x.settings={...initial.settings,...(x.settings||{})};
 x.fuel=Array.isArray(x.fuel)?x.fuel:[];
 x.charge=Array.isArray(x.charge)?x.charge:[];
 x.mileage=Array.isArray(x.mileage)?x.mileage:[];
 x.maint=Array.isArray(x.maint)?x.maint:[];
 x.vehicles=Array.isArray(x.vehicles)?x.vehicles:[];
 x.customFuel=Array.isArray(x.customFuel)?x.customFuel:[];
 x.customCharge=Array.isArray(x.customCharge)?x.customCharge:[];
 ensureIds(x.fuel,'fuel');ensureIds(x.charge,'charge');ensureIds(x.mileage,'mileage');ensureIds(x.maint,'maint');ensureIds(x.vehicles,'vehicle');ensureIds(x.customFuel,'fuel');ensureIds(x.customCharge,'charge');
 // One-time migration from the old duplicated odometer field. Mileage history
 // is canonical in v2, so preserve a higher legacy value as a dated reading.
 const legacyOdo=Number(x.settings.vodo||0);
 x.mileage.sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.odo||0)-Number(b.odo||0));
 const latest=x.mileage.length?Number(x.mileage[x.mileage.length-1].odo||0):0;
 if(legacyOdo>latest){x.mileage.push({id:newId('mileage'),date:today(),odo:legacyOdo})}
 delete x.settings.vodo;
 x.mileage.sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.odo||0)-Number(b.odo||0));
 return x;
}
function currentVistiqOdo(){
 const rows=[...d.mileage].sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.odo||0)-Number(b.odo||0));
 return rows.length?Number(rows[rows.length-1].odo||0):0;
}
function setCurrentVistiqMileage(odo,date=today()){
 const n=Number(odo||0);if(!Number.isFinite(n)||n<0)return false;
 const same=d.mileage.find(x=>x.date===date);
 if(same){same.odo=n}else d.mileage.push({id:newId('mileage'),date,odo:n});
 d.mileage.sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.odo||0)-Number(b.odo||0));
 return true;
}

class GarageStore{
 constructor(){this.db=null;this.queue=Promise.resolve()}
 open(){
  if(this.db)return Promise.resolve(this.db);
  return new Promise((resolve,reject)=>{
   if(!('indexedDB' in window))return reject(new Error('IndexedDB unavailable'));
   const req=indexedDB.open(DB_NAME,DB_VERSION);
   req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE)};
   req.onsuccess=()=>{this.db=req.result;this.db.onversionchange=()=>this.db.close();resolve(this.db)};
   req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  });
 }
 async load(){
  const db=await this.open();
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(DB_STORE,'readonly');const req=tx.objectStore(DB_STORE).get('garage');
   req.onsuccess=()=>resolve(req.result?.data||null);req.onerror=()=>reject(req.error);
  });
 }
 async write(snapshot){
  const copy=JSON.parse(JSON.stringify(snapshot));
  const db=await this.open();
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(DB_STORE,'readwrite');
   tx.objectStore(DB_STORE).put({schemaVersion:SCHEMA_VERSION,savedAt:Date.now(),data:copy},'garage');
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
  });
 }
 save(snapshot){
  const copy=JSON.parse(JSON.stringify(snapshot));
  this.queue=this.queue.then(()=>this.write(copy)).catch(e=>console.warn('IndexedDB save failed',e));
  return this.queue;
 }
}
const store=new GarageStore();
let d=normalizeData(null);
let storageReady=false;

function readLegacy(){
 try{const raw=localStorage.getItem(LEGACY_KEY);return raw?normalizeData(JSON.parse(raw)):null}catch(e){console.warn('Legacy localStorage data unreadable',e);return null}
}
async function bootstrapStorage(){
 let loaded=null;
 try{loaded=await store.load()}catch(e){console.warn('IndexedDB unavailable; using localStorage fallback',e)}
 if(loaded){d=normalizeData(loaded)}
 else{
  const legacy=readLegacy();
  d=legacy||normalizeData(null);
  try{await store.save(d)}catch(e){console.warn('Initial IndexedDB migration failed',e)}
 }
 storageReady=true;
 render();
}
function save(){
 try{
  const snapshot=normalizeData(d);
  d=snapshot;
  // Keep a compact legacy mirror as an emergency recovery path. IndexedDB is
  // the canonical store; this mirror is never read when IndexedDB has data.
  localStorage.setItem(LEGACY_KEY,JSON.stringify(snapshot));
  store.save(snapshot);
  return true;
 }catch(e){console.error('Garage save failed',e);toast('Could not save garage data.');return false}
}
function today(){return new Date().toISOString().slice(0,10)}
document.addEventListener('click',function(e){
 const nav=e.target.closest('.nav button[data-nav]');
 if(nav){e.preventDefault();e.stopPropagation();show(nav.dataset.nav);return}
 const del=e.target.closest('.history-delete');
 if(del){e.preventDefault();e.stopPropagation();deleteHistoryItem(del.dataset.deleteKind,del.dataset.deleteId);return}
});

function toggleTheme(){
 const dark=!document.documentElement.classList.contains('dark');
 document.documentElement.classList.toggle('dark',dark);localStorage.setItem('garageTheme',dark?'dark':'light');updateThemeIcon();
}

function deleteHistoryItem(kind,id){
 const collections={fuel:d.fuel,charge:d.charge,mileage:d.mileage,maintenance:d.maint};
 const list=collections[kind];
 if(!list||!id)return;
 const item=list.find(x=>String(x.id)===String(id));
 if(!item)return;
 const labels={fuel:'fuel fill-up',charge:'charging session',mileage:'mileage reading',maintenance:'maintenance record'};
 if(!window.confirm('Delete this '+(labels[kind]||'history entry')+'?'))return;
 const index=list.findIndex(x=>String(x.id)===String(id));
 if(index<0)return;
 list.splice(index,1);
 // Current odometer is derived from mileage history and settings. Removing
 // the latest reading must therefore recalculate the canonical odometer.
 if(kind==='mileage'){
   const latest=[...d.mileage].sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.odo)-Number(b.odo)).pop();
   // Current mileage is derived from d.mileage; no duplicated odometer state.
 }
 if(!save())return;
 render();
 toast((labels[kind]||'History entry')+' deleted');
}

function updateThemeIcon(){
 const dark=document.documentElement.classList.contains('dark');
 const themeButton=document.getElementById('themeBtn'); if(!themeButton)return; themeButton.innerHTML=dark?'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>':'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z"/></svg>';
}
function openAddVehicle(){
 vehicleModalTitle.textContent='Add vehicle';editingVehicleId=null;vehicleSaveBtn.textContent='Add vehicle';
 newYear.value='';newMake.value='';newModel.value='';newImage.value='';newPower.value='Gas';newOwnership.value='Owned';
 ['newYear','newMake','newModel'].forEach(id=>setErr(id,false,''));
 vehicleModal.classList.add('show');
}
let editingVehicleId=null;
function closeVehicleModal(){vehicleModal.classList.remove('show');editingVehicleId=null}

function saveVehicleFromModal(){if(editingVehicleId){updateVehicle();}else{addVehicle();}}
function addVehicle(){
 const year=+newYear.value,make=newMake.value.trim(),model=newModel.value.trim(),power=newPower.value,ownership=newOwnership.value,image=newImage.value.trim();
 setErr('newYear',!(year>=1900&&year<=2100),'Enter a valid year.');setErr('newMake',!make,'Enter a make.');setErr('newModel',!model,'Enter a model.');
 if(!(year>=1900&&year<=2100)||!make||!model)return;
 d.vehicles.push({id:Date.now().toString(),year,make,model,power,ownership,image});editingVehicleId=null;
 save();closeVehicleModal();render();toast(year+' '+make+' '+model+' added');
}
function updateVehicle(){
 const year=+newYear.value,make=newMake.value.trim(),model=newModel.value.trim(),power=newPower.value,ownership=newOwnership.value,image=newImage.value.trim();
 setErr('newYear',!(year>=1900&&year<=2100),'Enter a valid year.');setErr('newMake',!make,'Enter a make.');setErr('newModel',!model,'Enter a model.');
 if(!(year>=1900&&year<=2100)||!make||!model)return;
 const v=d.vehicles.find(x=>x.id===editingVehicleId);if(!v)return;
 Object.assign(v,{year,make,model,power,ownership,image});save();closeVehicleModal();render();toast('Vehicle updated');
}

function openCustomVehicle(id){
 const v=d.vehicles.find(x=>x.id===id);if(!v)return;
 customVehicleTitle.textContent=v.year+' '+v.make+' '+v.model;
 customVehicleSubtitle.textContent=v.power+' · '+v.ownership;
 customVehicleContent.innerHTML=customTrackingMarkup(v);
 customVehicleModal.classList.add('show');
}
function closeCustomVehicle(){customVehicleModal.classList.remove('show');customVehicleContent.innerHTML=''}
function customTrackingMarkup(v){
 const fuelish=['Gas','Hybrid','Plug-in Hybrid'].includes(v.power);
 const electricish=['Electric','Plug-in Hybrid'].includes(v.power);
 const fuel=d.customFuel||[];
 const charge=d.customCharge||[];
 const maint=d.maint.filter(x=>x.vehicle===v.id);
 const fCost=fuel.filter(x=>x.vehicleId===v.id).reduce((s,x)=>s+x.spend,0);
 const cCost=charge.filter(x=>x.vehicleId===v.id).reduce((s,x)=>s+x.cost,0);
 const mCost=maint.reduce((s,x)=>s+x.cost,0);
 return `<div class="kpis">
   ${fuelish?`<div class="kpi"><b>${money(fCost)}</b><span>Fuel</span></div>`:''}
   ${electricish?`<div class="kpi"><b>${money(cCost)}</b><span>Charging</span></div>`:''}
   <div class="kpi"><b>${money(mCost)}</b><span>Maintenance</span></div>
   <div class="kpi"><b>${money(fCost+cCost+mCost)}</b><span>Total</span></div>
  </div>
  ${fuelish?`<section class="card" style="margin-top:14px"><h2>Add fuel</h2><div class="form">
   <div class="field"><label>Date *</label><input id="cvFuelDate" class="input" type="date"></div>
   <div class="field"><label>Odometer *</label><input id="cvFuelOdo" class="input" type="number" placeholder="km"></div>
   <div class="field"><label>Price per litre *</label><input id="cvFuelPrice" class="input" type="number" step=".001" placeholder="$ / L"></div>
   <div class="field"><label>Total spent *</label><input id="cvFuelSpend" class="input" type="number" step=".01" placeholder="$"></div>
   <button class="btn primary full" onclick="addCustomFuel('${v.id}')">Add fuel</button>
  </div></section>`:''}
  ${electricish?`<section class="card" style="margin-top:14px"><h2>Add charging</h2><div class="form">
   <div class="field"><label>Date *</label><input id="cvChargeDate" class="input" type="date"></div>
   <div class="field"><label>kWh added *</label><input id="cvChargeKwh" class="input" type="number" step=".1" placeholder="kWh"></div>
   <div class="field"><label>Rate</label><input id="cvChargeRate" class="input" type="number" step=".001" value=".098" placeholder="$/kWh"></div>
   <button class="btn primary full" onclick="addCustomCharge('${v.id}')">Add charging</button>
  </div></section>`:''}
  <section class="card" style="margin-top:14px"><h2>Add maintenance</h2><div class="form">
   <div class="field"><label>Date *</label><input id="cvMaintDate" class="input" type="date"></div>
   <div class="field"><label>Service *</label><input id="cvMaintType" class="input" placeholder="Oil change, tires..."></div>
   <div class="field"><label>Cost *</label><input id="cvMaintCost" class="input" type="number" step=".01" placeholder="$"></div>
   <div class="field"><label>Odometer</label><input id="cvMaintOdo" class="input" type="number" placeholder="km"></div>
   <button class="btn primary full" onclick="addCustomMaintenance('${v.id}')">Add maintenance</button>
  </div></section>
  <section class="card" style="margin-top:14px"><h2>Maintenance history</h2><div class="tablewrap"><table><thead><tr><th>Date</th><th>Service</th><th>Odometer</th><th>Cost</th></tr></thead><tbody>${maint.sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<tr><td>${dateFmt(x.date)}</td><td>${esc(x.type)}</td><td>${x.odo?fmt(x.odo):'—'}</td><td>${money(x.cost)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No maintenance logged yet.</td></tr>'}</tbody></table></div></section>`;
}
function ensureCustomArrays(){d.customFuel=d.customFuel||[];d.customCharge=d.customCharge||[]}
function addCustomFuel(id){
 ensureCustomArrays();
 const date=cvFuelDate.value,odo=+cvFuelOdo.value,price=+cvFuelPrice.value,spend=+cvFuelSpend.value;
 if(!date||!odo||!price||!spend){toast('Complete all fuel fields');return}
 const prev=[...d.customFuel].filter(x=>x.vehicleId===id&&x.odo<odo).sort((a,b)=>b.odo-a.odo)[0];
 const litres=spend/price,dist=prev?odo-prev.odo:0;
 d.customFuel.push({vehicleId:id,date,odo,price,spend,litres,eff:dist?litres/dist*100:null,cost100:dist?spend/dist*100:null});
 save();openCustomVehicle(id);toast('Fuel added');
}
function addCustomCharge(id){
 ensureCustomArrays();
 const date=cvChargeDate.value,kwh=+cvChargeKwh.value,rate=(cvChargeRate.value.trim()===''?d.settings.eRate:Number(cvChargeRate.value));
 if(!date||!kwh){toast('Enter date and kWh');return}
 d.customCharge.push({vehicleId:id,date,kwh,rate,cost:kwh*rate});
 save();openCustomVehicle(id);toast('Charging added');
}
function addCustomMaintenance(id){
 const date=cvMaintDate.value,type=cvMaintType.value.trim(),cost=+cvMaintCost.value,odo=+cvMaintOdo.value||0;
 if(!date||!type||!cost){toast('Complete date, service and cost');return}
 d.maint.push({date,vehicle:id,type,cost,odo});save();openCustomVehicle(id);toast('Maintenance added');
}


/* Reliable per-row history deletion */
function deleteHistoryItem(kind,id){
  const collections={fuel:d.fuel,charge:d.charge,mileage:d.mileage,maintenance:d.maint};
  const list=collections[kind];
  if(!Array.isArray(list)) return;
  const index=list.findIndex(x=>String(x.id)===String(id));
  if(index<0) return;

  const labels={fuel:'fuel fill-up',charge:'charging session',mileage:'mileage reading',maintenance:'maintenance record'};
  if(!window.confirm('Delete this '+labels[kind]+'?')) return;

  list.splice(index,1);

  if(kind==='mileage'){
    const latest=[...d.mileage].sort((a,b)=>{
      const date=String(a.date).localeCompare(String(b.date));
      return date || Number(a.odo||0)-Number(b.odo||0);
    }).pop();
    // Current mileage is derived from d.mileage; no duplicated odometer state.
  }

  if(!save()) return;
  render();
  setTimeout(addHistoryDeleteButtons,0);
  toast(labels[kind].charAt(0).toUpperCase()+labels[kind].slice(1)+' deleted');
}

function renderCustomVehicles(){
 const el=document.getElementById('customVehicles'); if(!el)return;
 ensureCustomArrays();
 el.innerHTML=d.vehicles.map(v=>{ const cf=d.customFuel.filter(x=>x.vehicleId===v.id).sort((a,b)=>a.date.localeCompare(b.date)); const cc=d.customCharge.filter(x=>x.vehicleId===v.id); const cm=d.maint.filter(x=>x.vehicle===v.id); const fuelCost=cf.reduce((sum,x)=>sum+(+x.spend||0),0), chargeCost=cc.reduce((sum,x)=>sum+(+x.cost||0),0), maintCost=cm.reduce((sum,x)=>sum+(+x.cost||0),0); const odos=cf.map(x=>+x.odo).filter(Boolean); const customDist=odos.length>1?Math.max(0,Math.max(...odos)-Math.min(...odos)):0; const costKm=customDist>0?(fuelCost+chargeCost+maintCost)/customDist:null; return `
 <article class="card vehicle">
  <div class="vehicle-art" style="background:var(--surface2)">${v.image?`<img loading="lazy" src="${esc(v.image)}" alt="${esc(v.year+' '+v.make+' '+v.model)}">`:`<div class="vehicle-image-placeholder">${esc(v.power)}</div>`}</div>
  <div class="vehicle-body"><div class="vehicle-title"><div><h2>${esc(v.year+' '+v.make+' '+v.model)}</h2><div class="vehicle-sub">${esc(v.power)}</div></div><span class="badge">${esc(v.ownership)}</span></div>
  <div class="quick-actions"><div class="cost-km"><b>${costKm!=null?money(costKm):'—'}</b><span>total cost/km</span></div>${['Electric','Plug-in Hybrid'].includes(v.power)?`<button class="btn quick-icon" title="Add charge" aria-label="Add charge" onclick="openQuickCharge('${v.id}')"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg></button>`:''}</div>
  </div>
 </article>`}).join('');
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function manageVehicle(id){
 const v=d.vehicles.find(x=>x.id===id);if(!v)return;
 vehicleModalTitle.textContent=v.year+' '+v.make+' '+v.model;
 newYear.value=v.year;newMake.value=v.make;newModel.value=v.model;newPower.value=v.power;newOwnership.value=v.ownership;newImage.value=v.image||'';
 vehicleModal.classList.add('show');
}

function leaseMetrics(){
 const s=d.settings;
 const start=new Date((s.leaseStart||initial.settings.leaseStart)+'T00:00:00');
 const end=new Date((s.leaseEnd||initial.settings.leaseEnd)+'T00:00:00');
 const now=new Date();
 const totalDays=Math.max(1,(end-start)/86400000);
 const elapsedDays=Math.min(totalDays,Math.max(0,(now-start)/86400000));
 const remainingDays=Math.max(0,(end-now)/86400000);
 const readings=[...d.mileage].sort((a,b)=>a.date.localeCompare(b.date)||a.odo-b.odo);
 const currentOdo=readings.length?Number(readings[readings.length-1].odo||0):0;
 const driven=Math.max(0,currentOdo-(+s.leaseOdo||0));
 const expected=s.allowance*(elapsedDays/totalDays);
 const ahead=driven-expected;
 const avgDay=elapsedDays>0?driven/elapsedDays:0;
 const projected=avgDay*totalDays+(+s.leaseOdo||0);
 const excess=Math.max(0,projected-s.allowance);
 const months=Math.max(0,(end-now)/86400000/30.4375);
 const projectedCost=excess*Math.max(0,+s.vRate||0);

 // Trend: compare the average daily rate over the latest 30 days
 // with the preceding 30 days. If the log is sparse, fall back to
 // the two most recent odometer intervals so the indicator still works.
 const todayMs=now.getTime();
 const windowRate=(fromMs,toMs)=>{
  const pts=readings.filter(r=>{
   const t=new Date(r.date+'T23:59:59').getTime();
   return t>=fromMs && t<=toMs;
  });
  if(pts.length<2) return null;
  const first=pts[0], last=pts[pts.length-1];
  const days=Math.max(1,(new Date(last.date)-new Date(first.date))/86400000);
  return Math.max(0,(+last.odo-+first.odo))/days;
 };
 let recentDayRate=windowRate(todayMs-30*86400000,todayMs);
 let priorDayRate=windowRate(todayMs-60*86400000,todayMs-30*86400000);

 if(recentDayRate==null || priorDayRate==null){
  const intervals=[];
  for(let i=1;i<readings.length;i++){
   const a=readings[i-1], b=readings[i];
   const days=Math.max(1,(new Date(b.date)-new Date(a.date))/86400000);
   if(days<=90) intervals.push({rate:Math.max(0,(+b.odo-+a.odo))/days,date:b.date});
  }
  if(intervals.length>=2){
   const last=intervals[intervals.length-1], prev=intervals[intervals.length-2];
   recentDayRate=recentDayRate==null?last.rate:recentDayRate;
   priorDayRate=priorDayRate==null?prev.rate:priorDayRate;
  }
 }

 let trend='flat', trendPct=0;
 if(recentDayRate!=null && priorDayRate!=null){
  trendPct=priorDayRate>0?((recentDayRate-priorDayRate)/priorDayRate)*100:0;
  const threshold=Math.max(0.5,priorDayRate*.05);
  const delta=recentDayRate-priorDayRate;
  trend=delta>threshold?'up':delta<-threshold?'down':'flat';
 }

 const remainingAllowance=Math.max(0,(+s.allowance||0)-currentOdo);
 const targetDay=remainingDays>0?remainingAllowance/remainingDays:0;
 return {start,end,totalDays,elapsedDays,remainingDays,currentOdo,driven,expected,ahead,avgDay,projected,excess,months,projectedCost,recentDayRate,priorDayRate,trend,trendPct,targetDay};
}
function renderLeaseProjection(){
 const m=leaseMetrics();
 leaseMonths.textContent=m.months.toFixed(1);
 leaseExpected.textContent=fmt(m.expected);
 leasePace.textContent=(m.ahead>=0?'+':'-')+fmt(Math.abs(m.ahead));
 leaseAvgDay.textContent=m.avgDay.toFixed(1);
 leaseTrend.textContent=m.trend==='up'?'↑':m.trend==='down'?'↓':'→';
 leaseTrend.className='pace-trend '+m.trend;
 const trendLabel=m.trend==='up'
  ? `Driving pace is trending upward${m.trendPct?` (${Math.abs(m.trendPct).toFixed(0)}% faster recently)`:''}`
  : m.trend==='down'
   ? `Driving pace is trending downward${m.trendPct?` (${Math.abs(m.trendPct).toFixed(0)}% slower recently)`:''}`
   : 'Driving pace is roughly unchanged';
 leaseTrend.title=trendLabel;
 leaseTrend.setAttribute('aria-label',trendLabel);
 leaseProjected.textContent=fmt(m.projected);
 leaseExcess.textContent=m.excess?fmt(m.excess):'0';
 leaseTargetDay.textContent=m.targetDay.toFixed(1)+' km/day';
 leaseTargetText.textContent=m.remainingDays>0
  ? `Average no more than ${m.targetDay.toFixed(1)} km/day from today to lease end to stay within your ${fmt(d.settings.allowance)} km allowance.`
  : 'Lease end reached.';
 leaseCostTitle.textContent=m.excess?'Projected excess mileage cost: '+money(m.projectedCost):'Projected to stay within lease allowance';
 leaseCostText.textContent=m.excess
  ? `At your current ${m.avgDay.toFixed(1)} km/day pace, you would finish around ${fmt(m.projected)} km — about ${fmt(m.excess)} km over the ${fmt(d.settings.allowance)} km allowance.`
  : `At your current ${m.avgDay.toFixed(1)} km/day pace, you are projected to finish within your ${fmt(d.settings.allowance)} km allowance.`;
 calculateWhatIf();
}
function setWhatIf(km){whatIfKm.value=km;calculateWhatIf()}
function calculateWhatIf(){
 const monthly=Math.max(0,+whatIfKm.value||0),m=leaseMetrics();
 if(!monthly){whatIfResult.textContent='—';whatIfDetail.textContent='Enter a monthly driving rate to see the projection.';return}
 const projected=m.driven+monthly*m.months+(+d.settings.leaseOdo||0);
 const excess=Math.max(0,projected-d.settings.allowance);
 const cost=excess*Math.max(0,+d.settings.vRate||0);
 whatIfResult.textContent=excess?`${fmt(excess)} km over · ${money(cost)}`:`${fmt(Math.max(0,d.settings.allowance-projected))} km under allowance`;
 whatIfDetail.textContent=`At ${fmt(monthly)} km/month for the remaining ${m.months.toFixed(1)} months, projected lease-end mileage is ${fmt(projected)} km.`;
}


function reconcileVistiqMileage(){return currentVistiqOdo()}


function render(){
 reconcileVistiqMileage();
 renderCustomVehicles();
 const f=[...d.fuel].sort((a,b)=>a.date.localeCompare(b.date));
 const c=[...d.charge].sort((a,b)=>a.date.localeCompare(b.date));
 const fs=f.reduce((s,x)=>s+x.spend,0),cs=c.reduce((s,x)=>s+x.cost,0);
 const mt=d.maint.reduce((s,x)=>s+x.cost,0);
 const eff=f.filter(x=>x.eff),avg=eff.length?eff.reduce((s,x)=>s+x.eff,0)/eff.length:null;
 const avgCost=eff.length?eff.reduce((s,x)=>s+x.cost100,0)/eff.length:null;
 const totalFuel=f.reduce((s,x)=>s+x.litres,0);
 const miles=[...d.mileage].sort((a,b)=>a.date.localeCompare(b.date));
 const totalKwh=c.reduce((s,x)=>s+x.kwh,0);
 const dist=miles.length>1?miles[miles.length-1].odo-miles[0].odo:0;
 const audiDist=f.length>1?f[f.length-1].odo-f[0].odo:0;
 const ma=d.maint.filter(x=>x.vehicle==='Audi A7').reduce((s,x)=>s+x.cost,0);
 const mv=d.maint.filter(x=>x.vehicle==='Cadillac VISTIQ').reduce((s,x)=>s+x.cost,0);
 const audiCostKmValue=audiDist>0?(fs+ma)/audiDist:null;
 const vistiqCostKmValue=dist>0?(cs+mv)/dist:null;
 const cEff=dist>0?(totalKwh/dist)*100:null;
 const year=String(new Date().getFullYear());
 const audiYtd=ytdAudiMileage(f),vistiqYtd=ytdMileageFromReadings(miles),garageYtd=audiYtd+vistiqYtd;
 const monthsElapsed=new Date().getMonth()+1;
 metricAudiYtd.textContent=fmt(audiYtd)+' km';
 metricVistiqYtd.textContent=fmt(vistiqYtd)+' km';
 metricGarageYtd.textContent=fmt(garageYtd)+' km';
 metricAvgMonth.textContent=fmt(garageYtd/Math.max(1,monthsElapsed))+' km';
 metricFuelSpend.textContent=money(f.filter(x=>x.date.slice(0,4)===year).reduce((s,x)=>s+x.spend,0));
 metricTotalSpend.textContent=money(
  f.filter(x=>x.date.slice(0,4)===year).reduce((s,x)=>s+x.spend,0)+
  c.filter(x=>x.date.slice(0,4)===year).reduce((s,x)=>s+x.cost,0)+
  d.maint.filter(x=>x.date.slice(0,4)===year).reduce((s,x)=>s+x.cost,0)
 );
 const currentOdo=currentVistiqOdo();
 const pct=currentOdo/d.settings.allowance*100;
 audiEff.textContent=avg?avg.toFixed(1):'—';audiCost.textContent=avgCost?money(avgCost):'—';audiCostKm.textContent=audiCostKmValue!=null?money(audiCostKmValue):'—';
 aAvg.textContent=avg?avg.toFixed(1):'—';aCost100.textContent=avgCost?money(avgCost):'—';
 aTotalFuel.textContent=totalFuel.toFixed(1)+' L';aTotalSpend.textContent=money(fs);aServiceTotal.textContent=money(ma);
 vRemain.textContent=fmt(Math.max(0,d.settings.allowance-currentOdo));vEnergy.textContent=totalKwh.toFixed(1);
 vKm.textContent=fmt(currentOdo);vRem.textContent=fmt(Math.max(0,d.settings.allowance-currentOdo));
 const currentPct=currentOdo/d.settings.allowance*100;
 vKwh100.textContent=cEff?cEff.toFixed(1):'—';vCost100.textContent=cEff?money(cEff*d.settings.eRate):'—';vistiqCostKm.textContent=vistiqCostKmValue!=null?money(vistiqCostKmValue):'—';vLeasePct.textContent=currentPct.toFixed(1)+'%';vBar.style.width=Math.min(100,currentPct)+'%';renderLeaseProjection();
 sumFuel.textContent=money(fs);sumCharge.textContent=money(cs);sumTotal.textContent=money(fs+cs+mt);
 garageAudiMaint.textContent=money(ma);garageVistiqMaint.textContent=money(mv);
 garageAudiTotal.textContent=money(fs+ma);garageVistiqTotal.textContent=money(cs+mv);
 aMaintTotal.textContent=money(ma);aMaintCount.textContent=d.maint.filter(x=>x.vehicle==='Audi A7').length;
 vMaintTotal.textContent=money(mv);vMaintCount.textContent=d.maint.filter(x=>x.vehicle==='Cadillac VISTIQ').length;
 const aRows=d.maint.filter(x=>x.vehicle==='Audi A7').sort((a,b)=>b.date.localeCompare(a.date));
 const vRows=d.maint.filter(x=>x.vehicle==='Cadillac VISTIQ').sort((a,b)=>b.date.localeCompare(a.date));
 document.getElementById('aMaintHistory').innerHTML=aRows.map(x=>`<tr><td>${dateFmt(x.date)}</td><td>${x.type}</td><td>${x.odo?fmt(x.odo):'—'}</td><td>${money(x.cost)}</td><td class="history-action"><button type="button" class="history-delete" data-delete-kind="maintenance" data-delete-id="${x.id}" aria-label="Delete maintenance record">×</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No Audi maintenance logged yet.</td></tr>';
 document.getElementById('vMaintHistory').innerHTML=vRows.map(x=>`<tr><td>${dateFmt(x.date)}</td><td>${x.type}</td><td>${x.odo?fmt(x.odo):'—'}</td><td>${money(x.cost)}</td><td class="history-action"><button type="button" class="history-delete" data-delete-kind="maintenance" data-delete-id="${x.id}" aria-label="Delete maintenance record">×</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No VISTIQ maintenance logged yet.</td></tr>';
 document.getElementById('fuelHistory').innerHTML=f.slice().reverse().map(x=>`<tr><td>${dateFmt(x.date)}</td><td>${fmt(x.odo)}</td><td>${money(x.price)}</td><td>${money(x.spend)}</td><td>${x.litres.toFixed(1)}</td><td>${x.eff?x.eff.toFixed(1):'—'}</td><td class="history-action"><button type="button" class="history-delete" data-delete-kind="fuel" data-delete-id="${x.id}" aria-label="Delete fuel fill-up">×</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No fill-ups logged yet.</td></tr>';
 document.getElementById('chargeHistory').innerHTML=c.slice().reverse().map(x=>`<tr><td>${dateFmt(x.date)}</td><td>${x.kwh.toFixed(1)}</td><td>${money(x.rate)}</td><td>${money(x.cost)}</td><td class="history-action"><button type="button" class="history-delete" data-delete-kind="charge" data-delete-id="${x.id}" aria-label="Delete charging session">×</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No charging sessions logged yet.</td></tr>';
 const mh=miles.slice().reverse();
 const mileageHistoryEl=document.getElementById('mileageHistory');
 mileageHistoryEl.innerHTML=mh.map((x,i)=>{const older=mh[i+1];const since=older?+x.odo-+older.odo:0;return `<tr><td>${dateFmt(x.date)}</td><td>${fmt(x.odo)}</td><td>${since>0?fmt(since)+' km':'—'}</td><td class="history-action"><button type="button" class="history-delete" data-delete-kind="mileage" data-delete-id="${x.id}" aria-label="Delete mileage reading">×</button></td></tr>`}).join('')||'<tr><td colspan="4" class="empty">No mileage readings logged yet.</td></tr>';
 const overallMaintHistory=document.getElementById('maintHistory'); if(overallMaintHistory){overallMaintHistory.innerHTML=[...d.maint].sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<tr><td>${dateFmt(x.date)}</td><td>${x.vehicle}</td><td>${x.type}</td><td>${x.odo?fmt(x.odo):'—'}</td><td>${money(x.cost)}</td><td class="history-action"><button type="button" class="history-delete" data-delete-kind="maintenance" data-delete-id="${x.id}" aria-label="Delete maintenance record">×</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No maintenance logged yet.</td></tr>'; }
 drawFuel(f);drawGarageCharts(f,c,d.maint,miles);
}
function setErr(id,bad,msg){
 const el=document.getElementById(id),err=document.getElementById(id+'Err');
 if(!el||!err)return;
 el.classList.toggle('invalid',bad);err.textContent=msg;err.classList.toggle('show',bad);
}
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>toastEl.classList.remove('show'),2200)}
function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove('show'),2200)}

function addFuel(){
 const date=aDate.value,odo=+aOdo.value,price=+aPrice.value,spend=+aSpend.value;
 setErr('aDate',!date,'Choose a date.');setErr('aOdo',!odo,'Enter the odometer.');setErr('aPrice',!price,'Enter the price per litre.');setErr('aSpend',!spend,'Enter the total spent.');
 if(!date||!odo||!price||!spend)return;
 const sorted=[...d.fuel].sort((a,b)=>a.odo-b.odo),prev=sorted.filter(x=>x.odo<odo).pop();
 if(prev&&odo<=prev.odo){setErr('aOdo',true,'Odometer must be higher than the previous reading.');return}
 const litres=spend/price,dist=prev?odo-prev.odo:0;
 d.fuel.push({id:newId('fuel'),date,odo,price,spend,litres,eff:dist?litres/dist*100:null,cost100:dist?spend/dist*100:null});
 save();aOdo.value='';aSpend.value='';render();toast('Fuel fill-up added');
}
function addMileage(){
 const dateEl=document.getElementById('vMileageDate');
 const odoEl=document.getElementById('vMileageOdo');
 const date=dateEl?.value||'', odo=Number(odoEl?.value||0);
 setErr('vMileageDate',!date,'Choose a date.');
 setErr('vMileageOdo',!odo,'Enter the odometer.');
 if(!date||!odo)return;

 const readings=[...d.mileage].sort((a,b)=>a.date.localeCompare(b.date)||(+a.odo)-(+b.odo));
 const latest=readings[readings.length-1];

 // A later-dated reading cannot have a lower odometer.
 if(latest && date>=latest.date && odo<+latest.odo){
   setErr('vMileageOdo',true,'Odometer cannot be lower than the latest reading.');
   return;
 }

 // Same-day entries replace the existing reading instead of creating duplicates.
 const sameDay=d.mileage.find(x=>x.date===date);
 if(sameDay) sameDay.odo=odo;
 else d.mileage.push({id:newId('mileage'),date,odo});

 d.mileage.sort((a,b)=>a.date.localeCompare(b.date)||(+a.odo)-(+b.odo));
 
 if(!save())return;
 if(odoEl)odoEl.value='';
 render();
 toast(sameDay?'Mileage updated':'Mileage reading added');
}
function addCharge(){
 const date=vDate.value,kwh=+vKwh.value,rate=(vRate.value.trim()===''?d.settings.eRate:Number(vRate.value));
 setErr('vDate',!date,'Choose a date.');setErr('vKwh',!kwh,'Enter the energy added.');
 if(!date||!kwh)return;
 d.charge.push({id:newId('charge'),date,kwh,rate,cost:kwh*rate});save();vKwh.value='';render();toast('Charging session added');
}
function addMaintenanceVehicle(vehicle){
 const p=vehicle==='Audi A7'?{date:aMDate,type:aMType,cost:aMCost,odo:aMOdo}:{date:vMDate,type:vMType,cost:vMCost,odo:vMOdo};
 const ids=vehicle==='Audi A7'?['aMDate','aMType','aMCost']:['vMDate','vMType','vMCost'];
 const date=p.date.value,type=p.type.value.trim(),cost=+p.cost.value,odo=+p.odo.value||0;
 setErr(ids[0],!date,'Choose a date.');setErr(ids[1],!type,'Enter a service.');setErr(ids[2],!cost,'Enter a valid cost.');
 if(!date||!type||!cost)return;
 d.maint.push({id:newId('maint'),date,vehicle,type,cost,odo});save();p.type.value='';p.cost.value='';p.odo.value='';render();toast(vehicle+' maintenance added');
}

function chartTheme(){
 const cs=getComputedStyle(document.documentElement);
 return {text:cs.getPropertyValue('--text').trim(),muted:cs.getPropertyValue('--muted').trim(),line:cs.getPropertyValue('--line').trim(),blue:cs.getPropertyValue('--blue').trim(),surface:cs.getPropertyValue('--surface2').trim()};
}
function setupChart(id){
 const c=document.getElementById(id); if(!c)return null;
 const rect=c.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(320,Math.round(rect.width)),h=Math.max(160,Math.round(rect.height));
 c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
 return {c,x,w,h,t:chartTheme()};
}
function drawEmptyChart(id,msg){
 const q=setupChart(id);if(!q)return;const {x,t}=q;x.fillStyle=t.muted;x.font='13px system-ui';x.fillText(msg,14,30);
}
function monthKey(date){return date.slice(0,7)}
function monthLabel(k){const [y,m]=k.split('-');return new Date(+y,+m-1,1).toLocaleDateString(undefined,{month:'short',year:'2-digit'})}
function lastMonths(n=8){
 const now=new Date(),arr=[];for(let i=n-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);arr.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}return arr;
}
function drawLineChart(id,rows,valueKey,empty){
 if(!rows.length){drawEmptyChart(id,empty);return}
 const q=setupChart(id);if(!q)return;const {x,w,h,t}=q,p={l:40,r:10,t:12,b:28},iw=w-p.l-p.r,ih=h-p.t-p.b;
 const vals=rows.map(r=>r[valueKey]),mx=Math.max(...vals,1),mn=Math.min(0,Math.min(...vals)),range=mx-mn||1;
 x.strokeStyle=t.line;x.lineWidth=1;
 for(let i=0;i<4;i++){const y=p.t+i*ih/3;x.beginPath();x.moveTo(p.l,y);x.lineTo(w-p.r,y);x.stroke()}
 x.fillStyle=t.muted;x.font='10px system-ui';
 rows.forEach((r,i)=>{if(i%Math.ceil(rows.length/6)===0||i===rows.length-1){const px=p.l+(rows.length===1?iw/2:i/(rows.length-1)*iw);x.fillText(r.label,Math.max(p.l,px-15),h-8)}})
 x.strokeStyle=t.blue;x.lineWidth=2.5;x.beginPath();
 rows.forEach((r,i)=>{const px=p.l+(rows.length===1?iw/2:i/(rows.length-1)*iw),py=p.t+ih-(r[valueKey]-mn)/range*ih;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke();
 rows.forEach((r,i)=>{const px=p.l+(rows.length===1?iw/2:i/(rows.length-1)*iw),py=p.t+ih-(r[valueKey]-mn)/range*ih;x.fillStyle=t.blue;x.beginPath();x.arc(px,py,3.5,0,Math.PI*2);x.fill()});
}
function audiMileageByMonth(f){
 const sorted=[...f].sort((a,b)=>a.date.localeCompare(b.date)||a.odo-b.odo),by={};
 for(let i=1;i<sorted.length;i++){
  const dist=+sorted[i].odo-+sorted[i-1].odo;
  if(dist>=0){const k=monthKey(sorted[i].date);by[k]=(by[k]||0)+dist}
 }
 return by;
}
function ytdMileageFromReadings(readings){
 const year=new Date().getFullYear(),sorted=[...readings].sort((a,b)=>a.date.localeCompare(b.date));
 const inYear=sorted.filter(x=>x.date.slice(0,4)===String(year));
 if(!inYear.length)return 0;
 const before=sorted.filter(x=>x.date.slice(0,4)<String(year)).pop();
 const startOdo=before?+before.odo:+inYear[0].odo;
 return Math.max(0,+inYear[inYear.length-1].odo-startOdo);
}
function ytdAudiMileage(f){
 const year=new Date().getFullYear(),sorted=[...f].sort((a,b)=>a.date.localeCompare(b.date)||a.odo-b.odo);
 const inYear=sorted.filter(x=>x.date.slice(0,4)===String(year));
 if(!inYear.length)return 0;
 const before=sorted.filter(x=>x.date.slice(0,4)<String(year)).pop();
 const startOdo=before?+before.odo:+inYear[0].odo;
 return Math.max(0,+inYear[inYear.length-1].odo-startOdo);
}

function drawMileageChart(miles){
 const sorted=[...miles].sort((a,b)=>a.date.localeCompare(b.date)),by={};
 for(let i=1;i<sorted.length;i++){const dist=sorted[i].odo-sorted[i-1].odo;if(dist>=0){const k=monthKey(sorted[i].date);by[k]=(by[k]||0)+dist}}
 const keys=lastMonths(8).filter(k=>by[k]!=null);
 drawLineChart('garageMileageChart',keys.map(k=>({label:monthLabel(k),km:by[k]})),'km','Add more VISTIQ mileage readings to see monthly driving.');
}
function drawAudiMileageChart(f){
 const by=audiMileageByMonth(f);
 const keys=lastMonths(8).filter(k=>by[k]!=null);
 drawLineChart('garageAudiMileageChart',keys.map(k=>({label:monthLabel(k),km:by[k]})),'km','Add more Audi fill-ups to see monthly driving.');
}

function drawSpendChart(f,c,maint){
 const keys=lastMonths(8),rows=keys.map(k=>({label:monthLabel(k),fuel:0,charge:0,maint:0}));
 const map=Object.fromEntries(rows.map(r=>[r.label,r]));
 const raw={};keys.forEach(k=>raw[k]={label:monthLabel(k),fuel:0,charge:0,maint:0});
 f.forEach(x=>{const k=monthKey(x.date);if(raw[k])raw[k].fuel+=+x.spend||0});
 c.forEach(x=>{const k=monthKey(x.date);if(raw[k])raw[k].charge+=+x.cost||0});
 maint.forEach(x=>{const k=monthKey(x.date);if(raw[k])raw[k].maint+=+x.cost||0});
 const data=keys.map(k=>raw[k]);
 const q=setupChart('garageSpendChart');if(!q)return;
 const {x,w,h,t}=q,p={l:42,r:10,t:12,b:28},iw=w-p.l-p.r,ih=h-p.t-p.b,max=Math.max(...data.map(r=>r.fuel+r.charge+r.maint),1);
 x.strokeStyle=t.line;x.lineWidth=1;for(let i=0;i<4;i++){const y=p.t+i*ih/3;x.beginPath();x.moveTo(p.l,y);x.lineTo(w-p.r,y);x.stroke()}
 const bw=Math.min(42,iw/data.length*.62);
 data.forEach((r,i)=>{const bx=p.l+(i+.5)*iw/data.length-bw/2,parts=[['fuel',r.fuel],['charge',r.charge],['maint',r.maint]];let bottom=h-p.b;parts.forEach(([k,val],j)=>{const bh=val/max*ih;if(bh>0){x.fillStyle=j===0?t.blue:j===1?t.muted:t.text;x.globalAlpha=j===2?.55:1;x.fillRect(bx,bottom-bh,bw,bh);bottom-=bh;x.globalAlpha=1}});x.fillStyle=t.muted;x.font='10px system-ui';x.fillText(r.label,bx-7,h-8)});
 x.fillStyle=t.muted;x.font='10px system-ui';x.fillText('Fuel',p.l,10);x.fillText('Charge',p.l+38,10);x.fillText('Maintenance',p.l+80,10);
}
function drawEfficiencyChart(f){
 const rows=f.filter(x=>x.eff).slice(-8).map(x=>({label:monthLabel(monthKey(x.date)),eff:x.eff}));
 drawLineChart('garageEfficiencyChart',rows,'eff','Add two or more Audi fill-ups to see efficiency.');
}
function drawGarageCharts(f,c,maint,miles){drawMileageChart(miles);drawAudiMileageChart(f);drawSpendChart(f,c,maint);drawEfficiencyChart(f)}
function drawFuel(f){
 const c=document.getElementById('fuelChart'),x=c.getContext('2d'),w=c.width,h=c.height;x.clearRect(0,0,w,h);
 const q=f.filter(z=>z.eff);if(!q.length){x.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted');x.font='14px system-ui';x.fillText('Add two or more fill-ups to see your efficiency trend.',20,32);return}
 const vals=q.map(z=>z.eff),mx=Math.max(...vals)*1.1,mn=Math.min(...vals)*.9;
 x.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--line');x.lineWidth=1;
 for(let i=1;i<4;i++){let y=i*h/4;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
 x.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--blue');x.lineWidth=3;x.beginPath();
 q.forEach((z,i)=>{let px=q.length===1?w/2:i/(q.length-1)*w,py=h-(z.eff-mn)/(mx-mn)*h;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke();
 q.forEach((z,i)=>{let px=q.length===1?w/2:i/(q.length-1)*w,py=h-(z.eff-mn)/(mx-mn)*h;x.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--blue');x.beginPath();x.arc(px,py,5,0,Math.PI*2);x.fill()});
}
function openQuickCharge(vehicleId){
 window.quickChargeVehicleId=vehicleId||null;
 const v=vehicleId&&d.vehicles.find(x=>x.id===vehicleId);
 quickChargeTitle.textContent=v?'Add charge · '+v.make+' '+v.model:'Add VISTIQ charge';
 quickChargeSubtitle.textContent=v?'Quick entry':'Quick entry';
 qChargeDate.value=new Date().toISOString().slice(0,10);
 qChargeKwh.value='';qChargeRate.value=d.settings.eRate||.098;
 quickChargeModal.classList.add('show');
 setTimeout(()=>qChargeKwh.focus(),80);
}
function closeQuickCharge(){quickChargeModal.classList.remove('show');window.quickChargeVehicleId=null}
function saveQuickCharge(){
 const date=qChargeDate.value,kwh=+qChargeKwh.value,rate=(qChargeRate.value.trim()===''?d.settings.eRate:Number(qChargeRate.value));
 if(!date||!kwh){toast('Enter date and kWh');return}
 if(window.quickChargeVehicleId){
  d.customCharge=d.customCharge||[];
  d.customCharge.push({id:newId('charge'),vehicleId:window.quickChargeVehicleId,date,kwh,rate,cost:kwh*rate});
 }else{
  d.charge.push({id:newId('charge'),date,kwh,rate,cost:kwh*rate});
 }
 save();closeQuickCharge();render();toast('Charging added');
}

function openQuickFuel(){
 qFuelDate.value=new Date().toISOString().slice(0,10);
 qFuelOdo.value='';qFuelPrice.value='';qFuelSpend.value='';
 quickFuelModal.classList.add('show');
 setTimeout(()=>qFuelOdo.focus(),80);
}
function closeQuickFuel(){quickFuelModal.classList.remove('show')}
function saveQuickFuel(){
 const date=qFuelDate.value,odo=+qFuelOdo.value,price=+qFuelPrice.value,spend=+qFuelSpend.value;
 if(!date||!odo||!price||!spend){toast('Complete all fuel fields');return}
 const prev=[...d.fuel].filter(x=>x.odo<odo).sort((a,b)=>b.odo-a.odo)[0];
 const litres=spend/price,dist=prev?odo-prev.odo:0;
 d.fuel.push({id:newId('fuel'),date,odo,price,spend,litres,eff:dist?litres/dist*100:null,cost100:dist?spend/dist*100:null});
 save();closeQuickFuel();render();toast('Audi fuel added');
}
function importData(event){
 const file=event.target.files&&event.target.files[0];if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{
  try{
   const incoming=JSON.parse(reader.result);
   if(!incoming||typeof incoming!=='object'||!Array.isArray(incoming.fuel)||!Array.isArray(incoming.charge)||!Array.isArray(incoming.maint)){
    throw new Error('Invalid backup');
   }
   if(!confirm('Import this backup and replace the garage data currently stored on this device?'))return;
   d={
    settings:{...initial.settings,...(incoming.settings||{})},
    fuel:incoming.fuel||[],
    charge:incoming.charge||[],
    maint:incoming.maint||[],
    mileage:incoming.mileage||[],
    vehicles:incoming.vehicles||[],
    customFuel:incoming.customFuel||[],
    customCharge:incoming.customCharge||[]
   };
   save();render();toast('Garage backup imported');
  }catch(e){toast('That backup file is not valid')}
  event.target.value='';
 };
 reader.readAsText(file);
}


let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
 e.preventDefault();
 deferredInstallPrompt=e;
 const b=document.getElementById('installAppBtn'); if(b)b.style.display='';
});
window.addEventListener('appinstalled',()=>{
 deferredInstallPrompt=null;
 const b=document.getElementById('installAppBtn'); if(b)b.style.display='none';
 closeInstall();
 toast('Garage installed');
});
function openInstall(){
 if(deferredInstallPrompt) installGarage();
 else installModal.classList.add('show');
}
function closeInstall(){installModal.classList.remove('show')}
async function installGarage(){
 if(!deferredInstallPrompt){installModal.classList.add('show');return}
 const prompt=deferredInstallPrompt;
 deferredInstallPrompt=null;
 await prompt.prompt();
 const result=await prompt.userChoice;
 if(result.outcome==='accepted') toast('Installing Garage');
}

function exportData(){
 const backup={
  app:'My Garage',
  formatVersion:1,
  exportedAt:new Date().toISOString(),
  settings:{...d.settings},
  fuel:d.fuel.map(x=>({...x})),
  charge:d.charge.map(x=>({...x})),
  mileage:d.mileage.map(x=>({...x})),
  maint:d.maint.map(x=>({...x})),
  vehicles:d.vehicles.map(x=>({...x})),
  customFuel:d.customFuel.map(x=>({...x})),
  customCharge:d.customCharge.map(x=>({...x}))
 };
 const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 const stamp=new Date().toISOString().slice(0,10);
 a.href=url;a.download=`garage-backup-${stamp}.json`;
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast('Garage data exported');
}
function openSettings(){
 reconcileVistiqMileage();
 $('sAllowance').value=d.settings.allowance;
 $('sLeaseStart').value=d.settings.leaseStart||initial.settings.leaseStart;
 $('sLeaseEnd').value=d.settings.leaseEnd||initial.settings.leaseEnd;
 $('sLeaseOdo').value=d.settings.leaseOdo||0;
 if($('sVodo')) $('sVodo').value=currentVistiqOdo();
 $('sVrate').value=d.settings.vRate;
 $('sERate').value=d.settings.eRate;
 $('settingsModal').classList.add('show');
}
function closeSettings(){settingsModal.classList.remove('show')}
function saveSettings(){
 const allowance=Number(sAllowance.value),leaseOdo=Number(sLeaseOdo.value||0),vRate=Number(sVrate.value),eRate=Number(sERate.value);
 if(!Number.isFinite(allowance)||allowance<0||!Number.isFinite(leaseOdo)||leaseOdo<0||!Number.isFinite(vRate)||vRate<0||!Number.isFinite(eRate)||eRate<0){toast('Enter valid garage settings');return}
 d.settings.allowance=allowance;
 d.settings.leaseStart=sLeaseStart.value||initial.settings.leaseStart;
 d.settings.leaseEnd=sLeaseEnd.value||initial.settings.leaseEnd;
 d.settings.leaseOdo=leaseOdo;
 const enteredOdo=Number(($('sVodo')?.value||currentVistiqOdo()));
 if(Number.isFinite(enteredOdo)&&enteredOdo>=0&&enteredOdo!==currentVistiqOdo())setCurrentVistiqMileage(enteredOdo);
 d.settings.vRate=vRate;d.settings.eRate=eRate;
 save();closeSettings();render();toast('Garage settings saved');
}

if(localStorage.getItem('garageTheme')!=='light')document.documentElement.classList.add('dark');
updateThemeIcon();
aDate.value=vDate.value=vMileageDate.value=aMDate.value=vMDate.value=today();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
bootstrapStorage();
