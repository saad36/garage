const CACHE="garage-v34";
const ASSETS=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./icon.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 if(e.request.mode==="navigate"){
   e.respondWith(fetch(e.request).then(r=>{caches.open(CACHE).then(c=>c.put("./index.html",r.clone()));return r}).catch(()=>caches.match("./index.html")));
 }else{
   e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{caches.open(CACHE).then(x=>x.put(e.request,r.clone()));return r})));
 }
});
