const CACHE="garage-v29";
const ASSETS=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const nav=e.request.mode==="navigate"||e.request.destination==="document";
 if(nav){
  e.respondWith(fetch(e.request,{cache:"no-store"}).then(async r=>{
   if(!r.ok)return r;
   let html=await r.text();
   const fix=`<script>(function(){window.addMileage=function(){try{var de=document.getElementById('vMileageDate'),oe=document.getElementById('vMileageOdo');var date=de&&de.value||'',odo=Number(oe&&oe.value||0);if(!date||!odo){if(typeof setErr==='function'){setErr('vMileageDate',!date,'Choose a date.');setErr('vMileageOdo',!odo,'Enter the odometer.')}return}var key='garageDataV1',d=JSON.parse(localStorage.getItem(key)||'null');if(!d)return;d.mileage=Array.isArray(d.mileage)?d.mileage:[];var latest=d.mileage.length?d.mileage.reduce(function(a,b){return Number(a.odo)>Number(b.odo)?a:b}:null);if(latest&&odo<Number(latest.odo)){if(typeof setErr==='function')setErr('vMileageOdo',true,'Odometer cannot be lower than the last reading.');return}d.mileage.push({date:date,odo:odo});d.settings=d.settings||{};d.settings.vodo=odo;var serialized=JSON.stringify(d);localStorage.setItem(key,serialized);localStorage.setItem('garageDataSavedAt',String(Date.now()));if(localStorage.getItem(key)!==serialized)throw new Error('Storage verification failed');if(oe)oe.value='';if(typeof render==='function')render();if(typeof toast==='function')toast('Mileage updated');}catch(err){console.error('Mileage save failed',err);if(typeof toast==='function')toast('Could not save mileage.');}}})();<\/script>`;
   html=html.replace('</body>',fix+'</body>');
   caches.open(CACHE).then(c=>c.put('./index.html',new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}})));
   return new Response(html,{headers:r.headers});
  }).catch(()=>caches.match('./index.html')));
 } else e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(x=>x.put(e.request,r.clone()));return r})));
});
