/* Garage v36.1
   Data-first dashboard renderer.
   - Uses one normalized localStorage document.
   - Migrates common legacy shapes without discarding records.
   - Dashboard KPIs/charts are derived from the same history arrays shown in vehicle pages.
   - JSON import accepts both the current export and common legacy/wrapped backups.
*/
(() => {
  "use strict";

  const STORAGE_KEY = "garageData";
  const LEGACY_KEYS = [
    STORAGE_KEY, "garage", "garageApp", "garageAppData",
    "myGarage", "myGarageData", "garageDataV35", "garageDataV36"
  ];

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const first = (obj, keys, fallback = undefined) => {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return fallback;
  };
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

  function todayISO() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,10);
  }
  function dateISO(value) {
    if (!value) return "";
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,10);
  }
  function dateMs(value) {
    const d = new Date(`${dateISO(value)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  function fmtNum(v, decimals = 1) {
    if (!Number.isFinite(Number(v))) return "—";
    return Number(v).toLocaleString("en-CA", {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals === 0 ? 0 : Math.min(decimals, 1)
    });
  }
  function fmtMoney(v) {
    return Number(v || 0).toLocaleString("en-CA", {
      style:"currency", currency:"CAD", minimumFractionDigits:2, maximumFractionDigits:2
    });
  }
  function fmtDate(v) {
    const s = dateISO(v);
    if (!s) return "—";
    return new Date(`${s}T12:00:00`).toLocaleDateString("en-CA", {
      month:"short", day:"numeric", year:"numeric"
    });
  }

  const DEFAULTS = {
    version: 36.1,
    settings: {
      allowance: 101847,
      leaseStart: "2026-04-27",
      leaseEnd: "2030-04-27",
      leaseOdo: 0,
      vOdo: 0,
      excessRate: 0.20,
      electricityRate: 0.098
    },
    vehicles: {
      audi: { name:"2016 Audi A7", ownership:"Owned", power:"gas" },
      vistiq: { name:"2026 Cadillac VISTIQ", ownership:"Leased", power:"electric" }
    },
    fuel: [],
    charging: [],
    mileage: [],
    maintenance: [],
    customVehicles: []
  };

  function blankState() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  function vehicleKey(value) {
    const s = String(value || "").toLowerCase();
    if (s.includes("vistiq") || s.includes("cadillac") || s === "ev") return "vistiq";
    if (s.includes("audi") || s.includes("a7") || s === "ice" || s === "gas") return "audi";
    return "";
  }

  function normalizeMileageRecord(raw, index = 0) {
    if (!raw || typeof raw !== "object") return null;
    const date = dateISO(first(raw, ["date","day","loggedAt","timestamp","createdAt"]));
    const odo = num(first(raw, ["odometer","odo","mileage","km","currentMileage"]));
    if (!date || !Number.isFinite(odo)) return null;
    const vehicle = vehicleKey(first(raw, ["vehicle","vehicleName","vehicleId","car","type","powertrain"])) ||
      (raw.vehicleKey === "vistiq" ? "vistiq" : raw.vehicleKey === "audi" ? "audi" : "");
    return {
      id: String(raw.id || raw._id || `m-${date}-${odo}-${index}`),
      date, odometer: odo, vehicle: vehicle || "vistiq",
      createdAt: raw.createdAt || date
    };
  }

  function normalizeFuelRecord(raw, index = 0) {
    if (!raw || typeof raw !== "object") return null;
    const date = dateISO(first(raw, ["date","day","loggedAt","timestamp"]));
    const odo = num(first(raw, ["odometer","odo","mileage"]));
    const price = num(first(raw, ["pricePerLitre","price","rate","costPerLitre"]), 0);
    const spend = num(first(raw, ["spend","totalSpent","total","cost","amount"]), 0);
    let litres = num(first(raw, ["litres","liters","volume","quantity"]), NaN);
    if (!Number.isFinite(litres) && price > 0 && spend >= 0) litres = spend / price;
    if (!date || !Number.isFinite(odo)) return null;
    return {
      id: String(raw.id || raw._id || `f-${date}-${odo}-${index}`),
      date, odometer: odo, pricePerLitre: price,
      spend, litres: Number.isFinite(litres) ? litres : 0,
      vehicle: "audi"
    };
  }

  function normalizeChargeRecord(raw, index = 0) {
    if (!raw || typeof raw !== "object") return null;
    const date = dateISO(first(raw, ["date","day","loggedAt","timestamp"]));
    const kwh = num(first(raw, ["kwh","kWh","energy","energyAdded","amount"]), NaN);
    if (!date || !Number.isFinite(kwh)) return null;

    // IMPORTANT: an explicit 0 is a valid override and must not be replaced by the default rate.
    const hasRate = ["rate","electricityRate","pricePerKwh","price","costPerKwh"].some(k => has(raw,k));
    const rateRaw = first(raw, ["rate","electricityRate","pricePerKwh","costPerKwh","price"], undefined);
    const costRaw = first(raw, ["cost","spend","total","amount"], undefined);
    return {
      id: String(raw.id || raw._id || `c-${date}-${kwh}-${index}`),
      date, kwh,
      rate: hasRate ? num(rateRaw, 0) : null,
      cost: costRaw !== undefined && costRaw !== null && costRaw !== "" ? num(costRaw, 0) : null,
      vehicle: "vistiq"
    };
  }

  function normalizeMaintenanceRecord(raw, index = 0) {
    if (!raw || typeof raw !== "object") return null;
    const date = dateISO(first(raw, ["date","day","loggedAt","timestamp"]));
    const cost = num(first(raw, ["cost","spend","amount","price"]), NaN);
    const service = String(first(raw, ["service","type","description","name"], "Maintenance"));
    if (!date || !Number.isFinite(cost)) return null;
    const vehicle = vehicleKey(first(raw, ["vehicle","vehicleName","vehicleId","car","type"])) ||
      (raw.vehicleKey === "audi" ? "audi" : raw.vehicleKey === "vistiq" ? "vistiq" : "");
    return {
      id: String(raw.id || raw._id || `x-${date}-${index}`),
      date, service, cost,
      odometer: num(first(raw, ["odometer","odo","mileage"]), 0),
      vehicle: vehicle || "vistiq"
    };
  }

  function normalizeCustom(raw, index=0) {
    if (!raw || typeof raw !== "object") return null;
    return {
      id: String(raw.id || raw._id || `v-${index}`),
      name: String(first(raw, ["name","model","vehicleName"], "Vehicle")),
      make: String(first(raw, ["make","brand"], "")),
      year: num(first(raw, ["year"], 0)),
      ownership: String(first(raw, ["ownership","status"], "Owned")),
      power: String(first(raw, ["power","fuelType","type"], "gas"))
    };
  }

  function normalizeState(input) {
    let src = input;
    if (!src || typeof src !== "object") src = {};
    // Accept exported wrappers.
    if (src.data && typeof src.data === "object") src = src.data;
    if (src.garageData && typeof src.garageData === "object") src = src.garageData;
    if (src.state && typeof src.state === "object") src = src.state;
    if (src.backup && typeof src.backup === "object") src = src.backup;

    const out = blankState();

    const settings = src.settings || src.lease || {};
    out.settings = {
      allowance: num(first(settings, ["allowance","totalAllowance","leaseAllowance"],
        first(src, ["allowance","leaseAllowance"], DEFAULTS.settings.allowance))),
      leaseStart: dateISO(first(settings, ["leaseStart","startDate"], DEFAULTS.settings.leaseStart)) || DEFAULTS.settings.leaseStart,
      leaseEnd: dateISO(first(settings, ["leaseEnd","endDate"], DEFAULTS.settings.leaseEnd)) || DEFAULTS.settings.leaseEnd,
      leaseOdo: num(first(settings, ["leaseOdo","startOdometer"], DEFAULTS.settings.leaseOdo)),
      vOdo: num(first(settings, ["vOdo","vistiqOdo","currentMileage"], DEFAULTS.settings.vOdo)),
      excessRate: num(first(settings, ["excessRate","excessMileageRate"], DEFAULTS.settings.excessRate)),
      electricityRate: num(first(settings, ["electricityRate","homeRate","defaultRate"], DEFAULTS.settings.electricityRate))
    };

    const vehicles = src.vehicles || {};
    const rootAudi = src.audi && typeof src.audi === "object" ? src.audi : {};
    const rootVistiq = src.vistiq && typeof src.vistiq === "object" ? src.vistiq : {};
    out.vehicles.audi = { ...out.vehicles.audi, ...(vehicles.audi || {}), ...rootAudi.vehicle };
    out.vehicles.vistiq = { ...out.vehicles.vistiq, ...(vehicles.vistiq || {}), ...rootVistiq.vehicle };

    const toArray = value => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        // Support keyed collections such as {id:{...}} as well as {audi:[...],vistiq:[...]}.
        const vals = Object.values(value);
        if (vals.every(v => v && typeof v === "object" && !Array.isArray(v))) return vals;
      }
      return [];
    };

    // Current app shapes plus several legacy aliases.
    const mileageRaw = src.mileage ?? src.mileageHistory ?? src.mileages ?? src.odoHistory ?? [];
    const fuelRaw = src.fuel ?? src.fuelHistory ?? src.fuelLogs ?? src.fillups ?? [];
    const chargeRaw = src.charging ?? src.chargingHistory ?? src.chargeHistory ?? src.charges ?? [];
    const maintRaw = src.maintenance ?? src.maintenanceHistory ?? src.maintenanceLogs ?? src.services ?? [];

    out.mileage = toArray(mileageRaw).map(normalizeMileageRecord).filter(Boolean);
    out.fuel = toArray(fuelRaw).map(normalizeFuelRecord).filter(Boolean);
    out.charging = toArray(chargeRaw).map(normalizeChargeRecord).filter(Boolean);
    out.maintenance = toArray(maintRaw).map(normalizeMaintenanceRecord).filter(Boolean);
    out.customVehicles = toArray(src.customVehicles).map(normalizeCustom).filter(Boolean);

    // Some legacy exports stored vehicle logs under vehicle objects.
    for (const key of ["audi","vistiq"]) {
      const v = vehicles[key] || (key==="audi" ? rootAudi : rootVistiq) || {};
      const vm = v.mileage || v.mileageHistory;
      if (Array.isArray(vm)) out.mileage.push(...vm.map(r => normalizeMileageRecord({...r,vehicle:key})).filter(Boolean));
      if (key === "audi") {
        const vf = v.fuel || v.fuelHistory;
        if (Array.isArray(vf)) out.fuel.push(...vf.map(normalizeFuelRecord).filter(Boolean));
      }
      if (key === "vistiq") {
        const vc = v.charging || v.chargeHistory;
        if (Array.isArray(vc)) out.charging.push(...vc.map(normalizeChargeRecord).filter(Boolean));
      }
      const vx = v.maintenance || v.maintenanceHistory;
      if (Array.isArray(vx)) out.maintenance.push(...vx.map(r => normalizeMaintenanceRecord({...r,vehicle:key})).filter(Boolean));
    }

    // A common legacy format has root-level per-vehicle arrays.
    if (out.mileage.length === 0) {
      for (const key of ["audi","vistiq"]) {
        const v = key==="audi" ? rootAudi : rootVistiq;
        const rows = toArray(v.mileage || v.mileageHistory || v.odoHistory);
        out.mileage.push(...rows.map(r=>normalizeMileageRecord({...r,vehicle:key})).filter(Boolean));
      }
    }
    if (out.fuel.length === 0) {
      out.fuel.push(...toArray(rootAudi.fuel || rootAudi.fuelHistory || rootAudi.fillups).map(normalizeFuelRecord).filter(Boolean));
    }
    if (out.charging.length === 0) {
      out.charging.push(...toArray(rootVistiq.charging || rootVistiq.chargeHistory || rootVistiq.charges).map(normalizeChargeRecord).filter(Boolean));
    }
    if (out.maintenance.length === 0) {
      for (const key of ["audi","vistiq"]) {
        const v = key==="audi" ? rootAudi : rootVistiq;
        out.maintenance.push(...toArray(v.maintenance || v.maintenanceHistory).map(r=>normalizeMaintenanceRecord({...r,vehicle:key})).filter(Boolean));
      }
    }

    // De-duplicate by stable id where possible.
    out.mileage = dedupe(out.mileage);
    out.fuel = dedupe(out.fuel);
    out.charging = dedupe(out.charging);
    out.maintenance = dedupe(out.maintenance);
    return out;
  }

  function dedupe(arr) {
    const seen = new Set();
    return arr.filter(r => {
      const key = r.id || JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  function findStoredState() {
    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return normalizeState(parsed);
      } catch (_) {}
    }
    // Last-resort discovery: look for a localStorage value containing recognizable garage arrays.
    try {
      for (let i=0; i<localStorage.length; i++) {
        const key = localStorage.key(i);
        const raw = localStorage.getItem(key);
        if (!raw || raw.length > 3_000_000) continue;
        try {
          const parsed = JSON.parse(raw);
          const s = normalizeState(parsed);
          if (s.mileage.length || s.fuel.length || s.charging.length || s.maintenance.length) return s;
        } catch (_) {}
      }
    } catch (_) {}
    return blankState();
  }

  let state = findStoredState();
  let chartInstances = new Map();
  let deferredInstallPrompt = null;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast("Could not save Garage data.");
      console.error(e);
      return false;
    }
  }

  function allMileage(vehicle) {
    return state.mileage
      .filter(r => r.vehicle === vehicle)
      .sort((a,b) => dateMs(a.date)-dateMs(b.date) || a.odometer-b.odometer);
  }
  function latestMileage(vehicle) {
    const rows = allMileage(vehicle);
    return rows.length ? rows[rows.length-1] : null;
  }
  function mileageDistance(vehicle) {
    const rows = allMileage(vehicle);
    let total = 0;
    for (let i=1;i<rows.length;i++) {
      const d = num(rows[i].odometer) - num(rows[i-1].odometer);
      if (d > 0) total += d;
    }
    return total;
  }
  function mileageYTD(vehicle, year = new Date().getFullYear()) {
    const rows = allMileage(vehicle);
    let total = 0;
    for (let i=1;i<rows.length;i++) {
      const d = num(rows[i].odometer) - num(rows[i-1].odometer);
      const y = new Date(`${rows[i].date}T12:00:00`).getFullYear();
      if (d > 0 && y === year) total += d;
    }
    return total;
  }
  function mileageByMonth(vehicle, count=12) {
    const now = new Date();
    const keys=[];
    for(let i=count-1;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
    }
    const vals=Object.fromEntries(keys.map(k=>[k,0]));
    const rows=allMileage(vehicle);
    for(let i=1;i<rows.length;i++){
      const d=num(rows[i].odometer)-num(rows[i-1].odometer);
      if(d<=0) continue;
      const k=rows[i].date.slice(0,7);
      if(k in vals) vals[k]+=d;
    }
    return keys.map(k=>({label:k.slice(0,7),value:vals[k]}));
  }

  function fuelTotal() { return state.fuel.reduce((s,r)=>s+num(r.spend),0); }
  function chargeCost(r) {
    if (r.cost !== null && r.cost !== undefined && Number.isFinite(Number(r.cost))) return num(r.cost);
    const rate = r.rate === null || r.rate === undefined ? state.settings.electricityRate : num(r.rate);
    return num(r.kwh) * rate;
  }
  function chargeTotal() { return state.charging.reduce((s,r)=>s+chargeCost(r),0); }
  function maintTotal(vehicle="") {
    return state.maintenance.filter(r=>!vehicle || r.vehicle===vehicle).reduce((s,r)=>s+num(r.cost),0);
  }
  function fuelMonthSpend() {
    const now=new Date();
    const keys=[];
    for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);}
    const vals=Object.fromEntries(keys.map(k=>[k,0]));
    state.fuel.forEach(r=>{if(r.date.slice(0,7) in vals) vals[r.date.slice(0,7)]+=num(r.spend)});
    state.charging.forEach(r=>{if(r.date.slice(0,7) in vals) vals[r.date.slice(0,7)]+=chargeCost(r)});
    state.maintenance.forEach(r=>{if(r.date.slice(0,7) in vals) vals[r.date.slice(0,7)]+=num(r.cost)});
    return keys.map(k=>({label:k,value:vals[k]}));
  }

  function vistiqEfficiency() {
    const kwh = state.charging.reduce((s,r)=>s+num(r.kwh),0);
    const distance = mileageDistance("vistiq");
    return { kwh100: distance>0 ? kwh/distance*100 : null, kwh, distance };
  }

  function monthlyKeys(count=12){
    const now=new Date(), keys=[];
    for(let i=count-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);}
    return keys;
  }

  function monthlyMileageMap(vehicle){
    const out=Object.fromEntries(monthlyKeys().map(k=>[k,0]));
    const rows=allMileage(vehicle);
    for(let i=1;i<rows.length;i++){const d=num(rows[i].odometer)-num(rows[i-1].odometer); const k=rows[i].date.slice(0,7); if(d>0&&k in out)out[k]+=d;}
    if(vehicle==="audi" && !rows.length){
      const f=state.fuel.slice().sort((a,b)=>dateMs(a.date)-dateMs(b.date)||a.odometer-b.odometer);
      for(let i=1;i<f.length;i++){const d=num(f[i].odometer)-num(f[i-1].odometer);const k=f[i].date.slice(0,7);if(d>0&&k in out)out[k]+=d;}
    }
    return out;
  }

  function monthlySpendMap(){
    const out=Object.fromEntries(monthlyKeys().map(k=>[k,0]));
    state.fuel.forEach(r=>{if(r.date.slice(0,7) in out)out[r.date.slice(0,7)]+=num(r.spend);});
    state.charging.forEach(r=>{if(r.date.slice(0,7) in out)out[r.date.slice(0,7)]+=chargeCost(r);});
    state.maintenance.forEach(r=>{if(r.date.slice(0,7) in out)out[r.date.slice(0,7)]+=num(r.cost);});
    return out;
  }

  function costKmByMonth(){
    const keys = monthlyKeys();
    const spend = monthlySpendMap();
    const mileage = Object.fromEntries(keys.map(k => [k, 0]));
    // Use the same odometer histories that power the mileage charts.
    ["audi", "vistiq"].forEach(vehicle => {
      const rows = allMileage(vehicle);
      for (let i = 1; i < rows.length; i++) {
        const d = num(rows[i].odometer) - num(rows[i-1].odometer);
        const k = String(rows[i].date || "").slice(0,7);
        if (d > 0 && k in mileage) mileage[k] += d;
      }
    });
    // If an Audi has no standalone mileage history, derive distance from
    // its fuel odometer readings (legacy-compatible behavior).
    if (!allMileage("audi").length && state.fuel.length) {
      const f = state.fuel.slice().sort((a,b) => dateMs(a.date)-dateMs(b.date) || num(a.odometer)-num(b.odometer));
      for (let i = 1; i < f.length; i++) {
        const d = num(f[i].odometer) - num(f[i-1].odometer);
        const k = String(f[i].date || "").slice(0,7);
        if (d > 0 && k in mileage) mileage[k] += d;
      }
    }
    return keys.map(k => ({
      label: k,
      value: mileage[k] > 0 && spend[k] > 0 ? spend[k] / mileage[k] : null
    }));
  }

  function leasePaceByMonth(){
    const keys = monthlyKeys();
    const s = state.settings || {};
    const start = s.leaseStart;
    const end = s.leaseEnd;
    const allowance = num(s.allowance);
    const first = num(s.leaseOdo);
    if (!start || !end || !allowance || !Number.isFinite(dateMs(start)) || !Number.isFinite(dateMs(end)) || dateMs(end) <= dateMs(start)) {
      return [];
    }
    const startMs = dateMs(start), endMs = dateMs(end);
    const span = Math.max(1, endMs - startMs);
    const rows = allMileage("vistiq");
    return keys.map(k => {
      const nextMonth = new Date(`${k}-01T12:00:00`);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(0);
      const date = nextMonth.toISOString().slice(0,10);
      const ms = Math.min(endMs, Math.max(startMs, dateMs(date)));
      const target = allowance * Math.max(0, Math.min(1, (ms - startMs) / span));
      let actualOdo = first;
      for (const r of rows) {
        const rMs = dateMs(r.date);
        if (Number.isFinite(rMs) && rMs <= ms) actualOdo = Math.max(actualOdo, num(r.odometer));
      }
      return {label:k, actual:Math.max(0, actualOdo-first), target:Math.max(0, target)};
    });
  }

  function fuelEfficiency() {
    const rows=state.fuel.slice().sort((a,b)=>dateMs(a.date)-dateMs(b.date)||a.odometer-b.odometer);
    let liters=0, distance=0, spend=0;
    for(let i=1;i<rows.length;i++){
      const d=num(rows[i].odometer)-num(rows[i-1].odometer);
      if(d>0){distance+=d;liters+=num(rows[i].litres);spend+=num(rows[i].spend);}
    }
    return {
      l100: distance>0 ? liters/distance*100 : null,
      cost100: distance>0 ? spend/distance*100 : null,
      liters: state.fuel.reduce((s,r)=>s+num(r.litres),0),
      spend
    };
  }
  function efficiencyByMonth() {
    const now=new Date(), keys=[];
    for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);}
    const buckets=Object.fromEntries(keys.map(k=>[k,{l:0,d:0}]));
    const rows=state.fuel.slice().sort((a,b)=>dateMs(a.date)-dateMs(b.date)||a.odometer-b.odometer);
    for(let i=1;i<rows.length;i++){
      const d=num(rows[i].odometer)-num(rows[i-1].odometer);
      const k=rows[i].date.slice(0,7);
      if(d>0 && buckets[k]){buckets[k].d+=d;buckets[k].l+=num(rows[i].litres);}
    }
    return keys.map(k=>({label:k,value:buckets[k].d?buckets[k].l/buckets[k].d*100:null}));
  }

  function vehicleCostKm(vehicle) {
    const distance = mileageDistance(vehicle) ||
      (vehicle==="audi" ? (() => {
        const rows=state.fuel.slice().sort((a,b)=>dateMs(a.date)-dateMs(b.date)||a.odometer-b.odometer);
        let d=0; for(let i=1;i<rows.length;i++){const x=rows[i].odometer-rows[i-1].odometer;if(x>0)d+=x;} return d;
      })() : 0);
    const operating = vehicle==="audi" ? fuelTotal() : chargeTotal();
    const total = operating + maintTotal(vehicle);
    return { total, distance, costKm: distance>0 ? total/distance : null };
  }

  function currentVistiqOdo() {
    return latestMileage("vistiq")?.odometer ?? num(state.settings.vOdo);
  }

  function renderAll() {
    renderHome();
    renderAudi();
    renderVistiq();
    setDefaults();
    drawAllCharts();
  }

  function renderHome() {
    const audi = vehicleCostKm("audi");
    const ev = vehicleCostKm("vistiq");
    setText("audiEff", fuelEfficiency().l100 == null ? "—" : fmtNum(fuelEfficiency().l100,1));
    setText("audiCost", fuelEfficiency().cost100 == null ? "—" : fmtMoney(fuelEfficiency().cost100));
    setText("vEnergy", `${fmtNum(state.charging.reduce((s,r)=>s+num(r.kwh),0),1)}`);
    setText("garageAudiTotal", fmtMoney(audi.total));
    setText("garageVistiqTotal", fmtMoney(ev.total));
    setText("garageAudiMaint", fmtMoney(maintTotal("audi")));
    setText("garageVistiqMaint", fmtMoney(maintTotal("vistiq")));
    setText("sumFuel", fmtMoney(fuelTotal()));
    setText("sumCharge", fmtMoney(chargeTotal()));
    setText("sumTotal", fmtMoney(audi.total + ev.total));

    setText("audiCostKm", audi.costKm == null ? "—" : fmtMoney(audi.costKm));
    setText("vistiqCostKm", ev.costKm == null ? "—" : fmtMoney(ev.costKm));

    const year = new Date().getFullYear();
    const aY = mileageYTD("audi", year), vY = mileageYTD("vistiq", year);
    const garage = aY + vY;
    const month = new Date().getMonth()+1;
    setText("metricAudiYtd", `${fmtNum(aY,0)} km`);
    setText("metricVistiqYtd", `${fmtNum(vY,0)} km`);
    setText("metricGarageYtd", `${fmtNum(garage,0)} km`);
    setText("metricAvgMonth", `${fmtNum(garage/Math.max(1,month),0)} km`);
    setText("metricFuelSpend", fmtMoney(fuelTotal()));
    const ySpend = [...state.fuel.map(r=>({date:r.date,cost:r.spend})),
      ...state.charging.map(r=>({date:r.date,cost:chargeCost(r)})),
      ...state.maintenance.map(r=>({date:r.date,cost:r.cost}))]
      .filter(r=>new Date(`${r.date}T12:00:00`).getFullYear()===year)
      .reduce((s,r)=>s+num(r.cost),0);
    setText("metricTotalSpend", fmtMoney(ySpend));
    const vEff = vistiqEfficiency();
    const vCost = vehicleCostKm("vistiq");
    setText("metricVistiqKwh100", vEff.kwh100 == null ? "—" : `${fmtNum(vEff.kwh100,1)}`);
    setText("metricVistiqCostKm", vCost.costKm == null ? "—" : fmtMoney(vCost.costKm));
    setText("metricAudiCostKm", audi.costKm == null ? "—" : fmtMoney(audi.costKm));
    setText("metricChargeSpend", fmtMoney(chargeTotal()));

    // Keep card text in sync even if a prior index.html omitted these IDs.
    const aCard = document.querySelector("#home .vehicle:nth-of-type(1) .cost-km");
    const vCard = document.querySelector("#home .vehicle:nth-of-type(2) .cost-km");
    if (aCard) aCard.title = audi.costKm == null ? "No distance data yet" : `${fmtMoney(audi.costKm)} per km including fuel and maintenance`;
    if (vCard) vCard.title = ev.costKm == null ? "No distance data yet" : `${fmtMoney(ev.costKm)} per km including charging and maintenance`;
  }

  function renderAudi() {
    const e=fuelEfficiency();
    setText("aAvg", e.l100 == null ? "—" : fmtNum(e.l100,1));
    setText("aCost100", e.cost100 == null ? "—" : `${fmtMoney(e.cost100)} / 100 km`);
    setText("aTotalFuel", `${fmtNum(e.liters,1)} L`);
    setText("aTotalSpend", fmtMoney(e.spend));
    setText("aServiceTotal", fmtMoney(maintTotal("audi")));
    renderFuelHistory();
    renderMaintHistory("audi","aMaintHistory");
    setText("aMaintTotal",fmtMoney(maintTotal("audi")));
    setText("aMaintCount",String(state.maintenance.filter(r=>r.vehicle==="audi").length));
  }

  function renderVistiq() {
    const odo = currentVistiqOdo();
    setText("vOdo", odo ? fmtNum(odo,0) : "—");
    setText("vRemain", fmtNum(Math.max(0,num(state.settings.allowance)-num(odo)),0));
    const pct = state.settings.allowance>0 ? Math.min(100,Math.max(0,odo/state.settings.allowance*100)) : 0;
    setText("vLeasePct", `${fmtNum(pct,1)}%`);
    const bar=$("vBar"); if(bar) bar.style.width=`${pct}%`;

    const rows=allMileage("vistiq");
    const firstOdo = num(state.settings.leaseOdo);
    const startDate = state.settings.leaseStart;
    const today = todayISO();
    const elapsedDays = Math.max(1,(dateMs(today)-dateMs(startDate))/86400000);
    const drivenSinceStart = Math.max(0,odo-firstOdo);
    const expected = state.settings.allowance * Math.min(1, elapsedDays/Math.max(1,(dateMs(state.settings.leaseEnd)-dateMs(startDate))/86400000));
    const pace = elapsedDays>0 ? drivenSinceStart/elapsedDays : 0;

    setText("leaseExpected", fmtNum(expected,1));
    setText("leasePace", `${drivenSinceStart-expected>=0?"+":""}${fmtNum(drivenSinceStart-expected,1)} km`);
    setText("leaseAvgDay", fmtNum(pace,1));

    const endDays = Math.max(0,(dateMs(state.settings.leaseEnd)-dateMs(today))/86400000);
    const projected = odo + pace*endDays;
    const excess = Math.max(0,projected-num(state.settings.allowance));
    setText("leaseProjected", fmtNum(projected,1));
    setText("leaseExcess", fmtNum(excess,1));
    setText("leaseMonths", fmtNum(endDays/30.4375,1));

    const safeDay = endDays>0 ? Math.max(0,(num(state.settings.allowance)-odo)/endDays) : 0;
    setText("leaseTargetDay", `${fmtNum(safeDay,1)} km/day`);
    setText("leaseTargetText", `Maximum average driving rate from today to lease end to stay within ${fmtNum(state.settings.allowance,0)} km`);
    setText("leaseCostTitle", excess>0 ? `Projected excess mileage cost: ${fmtMoney(excess*num(state.settings.excessRate))}` : "No projected excess mileage cost");
    setText("leaseCostText", excess>0
      ? `At your current ${fmtNum(pace,1)} km/day pace, you would finish around ${fmtNum(projected,1)} km — about ${fmtNum(excess,1)} km over the ${fmtNum(state.settings.allowance,0)} km allowance.`
      : `At your current ${fmtNum(pace,1)} km/day pace, you are projected to stay within the ${fmtNum(state.settings.allowance,0)} km allowance.`);

    const trend=$("leaseTrend");
    if(trend){
      // Compare recent daily rate to the previous comparable period.
      const r=rows.slice(-8);
      let recent=0, prior=0;
      if(r.length>=3){
        const mid=Math.floor(r.length/2);
        const calc=arr=>{
          if(arr.length<2)return 0;
          const dd=Math.max(1,(dateMs(arr[arr.length-1].date)-dateMs(arr[0].date))/86400000);
          return Math.max(0,(arr[arr.length-1].odometer-arr[0].odometer))/dd;
        };
        recent=calc(r.slice(mid)); prior=calc(r.slice(0,mid));
      }
      trend.textContent = recent>prior+0.5 ? "↑" : recent<prior-0.5 ? "↓" : "→";
      trend.className=`pace-trend ${recent>prior+0.5?"up":recent<prior-0.5?"down":"flat"}`;
      trend.setAttribute("aria-label",recent>prior+0.5?"Driving pace trending upward":recent<prior-0.5?"Driving pace trending downward":"Driving pace steady");
    }

    const e = state.charging.reduce((s,r)=>s+num(r.kwh),0);
    const dist=mileageDistance("vistiq");
    const cost=chargeTotal();
    setText("vKwh100", dist>0 ? fmtNum(e/dist*100,1) : "—");
    setText("vCost100", dist>0 ? `${fmtMoney(cost/dist*100)} / 100 km` : "—");
    renderChargeHistory();
    renderMileageHistory();
    renderMaintHistory("vistiq","vMaintHistory");
    setText("vMaintTotal",fmtMoney(maintTotal("vistiq")));
    setText("vMaintCount",String(state.maintenance.filter(r=>r.vehicle==="vistiq").length));
    setText("vRate",fmtMoney(state.settings.electricityRate));
  }

  function renderFuelHistory(){
    const el=$("fuelHistory"); if(!el)return;
    const rows=state.fuel.slice().sort((a,b)=>dateMs(b.date)-dateMs(a.date)||b.odometer-a.odometer);
    el.innerHTML=rows.length ? rows.map(r=>`
      <tr>
        <td>${fmtDate(r.date)}</td><td>${fmtNum(r.odometer,0)}</td>
        <td>${fmtNum(r.litres,1)}</td><td>${fmtMoney(r.pricePerLitre)}</td>
        <td>${fmtMoney(r.spend)}</td>
        <td><button class="row-delete" type="button" onclick="deleteHistory('fuel','${esc(r.id)}')" aria-label="Delete fill-up">×</button></td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">No Audi fuel logged yet.</td></tr>`;
  }

  function renderChargeHistory(){
    const el=$("chargeHistory"); if(!el)return;
    const rows=state.charging.slice().sort((a,b)=>dateMs(b.date)-dateMs(a.date));
    el.innerHTML=rows.length ? rows.map(r=>`
      <tr><td>${fmtDate(r.date)}</td><td>${fmtNum(r.kwh,1)}</td><td>${r.rate===null?"Default":fmtMoney(r.rate)}</td><td>${fmtMoney(chargeCost(r))}</td>
      <td><button class="row-delete" type="button" onclick="deleteHistory('charging','${esc(r.id)}')" aria-label="Delete charging session">×</button></td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">No VISTIQ charging logged yet.</td></tr>`;
  }

  function renderMileageHistory(){
    const el=$("mileageHistory"); if(!el)return;
    const rows=allMileage("vistiq").slice().sort((a,b)=>dateMs(b.date)-dateMs(a.date)||b.odometer-a.odometer);
    el.innerHTML=rows.length ? rows.map((r,idx)=>{
      const prev=rows[idx+1];
      const since=prev ? r.odometer-prev.odometer : null;
      return `<tr><td>${fmtDate(r.date)}</td><td>${fmtNum(r.odometer,0)}</td><td>${since!==null&&since>=0?fmtNum(since,0)+" km":"—"}</td>
        <td><button class="row-delete" type="button" onclick="deleteHistory('mileage','${esc(r.id)}')" aria-label="Delete mileage">×</button></td></tr>`;
    }).join("") : `<tr><td colspan="4" class="empty">No VISTIQ mileage logged yet.</td></tr>`;
  }

  function renderMaintHistory(vehicle, elementId){
    const el=$(elementId); if(!el)return;
    const rows=state.maintenance.filter(r=>r.vehicle===vehicle).slice().sort((a,b)=>dateMs(b.date)-dateMs(a.date));
    el.innerHTML=rows.length ? rows.map(r=>`
      <tr><td>${fmtDate(r.date)}</td><td>${esc(r.service)}</td><td>${r.odometer?fmtNum(r.odometer,0):"—"}</td><td>${fmtMoney(r.cost)}</td>
      <td><button class="row-delete" type="button" onclick="deleteHistory('maintenance','${esc(r.id)}')" aria-label="Delete maintenance record">×</button></td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">No ${vehicle==="audi"?"Audi":"VISTIQ"} maintenance logged yet.</td></tr>`;
  }

  function setText(id,value){const el=$(id);if(el)el.textContent=value;}
  function setVal(id,value){const el=$(id);if(el && value!==undefined && value!==null)el.value=value;}
  function setDefaults(){
    const defaults={
      aDate:todayISO(), vDate:todayISO(), vMileageDate:todayISO(), vMDate:todayISO(), aMDate:todayISO(),
      vRate:state.settings.electricityRate, qChargeDate:todayISO(), qChargeRate:state.settings.electricityRate,
      qFuelDate:todayISO(), whatIfKm:2000,
      sAllowance:state.settings.allowance,sLeaseStart:state.settings.leaseStart,sLeaseEnd:state.settings.leaseEnd,
      sLeaseOdo:state.settings.leaseOdo,sVodo:currentVistiqOdo(),sVrate:state.settings.excessRate,sERate:state.settings.electricityRate
    };
    Object.entries(defaults).forEach(([k,v])=>{const el=$(k);if(el && (!el.value || k.startsWith("s"))) el.value=v;});
  }

  function drawAllCharts(){
    // Render each chart independently. A problem with one metric must never
    // prevent the remaining dashboard charts from rendering.
    const jobs = [
      ["garageMileageChart", () => drawLineChart("garageMileageChart", mileageByMonth("vistiq"), "km")],
      ["garageAudiMileageChart", () => drawLineChart("garageAudiMileageChart", mileageByMonth("audi"), "km")],
      ["garageSpendChart", () => drawLineChart("garageSpendChart", fuelMonthSpend(), "$", true)],
      ["garageEfficiencyChart", () => drawLineChart("garageEfficiencyChart", efficiencyByMonth(), "L/100 km")],
      ["garageCostKmChart", () => drawLineChart("garageCostKmChart", costKmByMonth(), "$ / km", true)],
      ["leasePaceChart", () => drawMultiLineChart("leasePaceChart", leasePaceByMonth())]
    ];
    jobs.forEach(([id, fn]) => {
      try { fn(); }
      catch (e) {
        console.error("Garage chart failed:", id, e);
        const canvas = $(id);
        if (canvas) {
          const c = chartBase(canvas);
          c.ctx.fillStyle = c.muted;
          c.ctx.font = "12px system-ui";
          c.ctx.textAlign = "center";
          c.ctx.textBaseline = "middle";
          c.ctx.fillText("No data yet", c.w / 2, c.h / 2);
        }
      }
    });
  }

  function chartLabel(label, value, unit, money){
    if(money) return fmtMoney(value);
    return `${fmtNum(value, value>=100?0:1)} ${unit}`;
  }

  function chartBase(canvas){
    const dpr=window.devicePixelRatio||1, rect=canvas.getBoundingClientRect();
    const w=Math.max(280,Math.floor(rect.width||canvas.clientWidth||850)), h=Math.max(170,Math.floor(rect.height||canvas.clientHeight||220));
    canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
    const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    const style=getComputedStyle(document.documentElement);
    return {ctx,w,h,muted:style.getPropertyValue("--muted").trim()||"#94a3b8",line:style.getPropertyValue("--line").trim()||"#263244",text:style.getPropertyValue("--text").trim()||"#f8fafc",accent:style.getPropertyValue("--blue").trim()||"#60a5fa",pad:{l:42,r:12,t:28,b:30}};
  }

  function monthLabel(label){const [yy,mm]=label.split("-");return new Date(Number(yy),Number(mm)-1,1).toLocaleDateString("en-CA",{month:"short"});}

  function drawLineChart(id,data,unit,money=false){
    const canvas=$(id); if(!canvas)return; const c=chartBase(canvas),{ctx,w,h,muted,line,accent,pad}=c;
    const valid=data.filter(x=>x.value!==null&&Number.isFinite(Number(x.value)));
    ctx.font="10px system-ui"; ctx.strokeStyle=line; ctx.fillStyle=muted; ctx.lineWidth=1;
    if(!valid.length){ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("No data yet",w/2,h/2);return;}
    const max=Math.max(...valid.map(x=>Number(x.value)),0), min=Math.min(...valid.map(x=>Number(x.value)),0), range=max-min||1, yMax=max+range*.16, yMin=Math.max(0,min-range*.08), plotW=w-pad.l-pad.r, plotH=h-pad.t-pad.b;
    for(let i=0;i<4;i++){const y=pad.t+plotH*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();const v=yMax-(yMax-yMin)*i/3;ctx.textAlign="right";ctx.textBaseline="middle";ctx.fillText(money?fmtMoney(v):fmtNum(v,v>=100?0:1),pad.l-6,y);}
    const pts=data.map((x,i)=>{if(x.value===null)return null;const v=Number(x.value);return {x:pad.l+(data.length===1?plotW/2:plotW*i/(data.length-1)),y:pad.t+(yMax-v)/(yMax-yMin)*plotH,value:v,label:x.label};});
    ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();let started=false;pts.forEach(p=>{if(!p){started=false;return;}if(!started){ctx.moveTo(p.x,p.y);started=true;}else ctx.lineTo(p.x,p.y);});ctx.stroke();
    ctx.font="10px system-ui"; pts.forEach(p=>{if(!p)return;ctx.fillStyle=accent;ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--text").trim()||"#f8fafc";ctx.textAlign="center";ctx.textBaseline="bottom";ctx.fillText(chartLabel(p.label,p.value,unit,money),p.x,Math.max(10,p.y-7));});
    ctx.fillStyle=muted;ctx.textAlign="center";ctx.textBaseline="top";data.forEach((x,i)=>{if(i%Math.max(1,Math.ceil(data.length/6))!==0&&i!==data.length-1)return;const xx=pad.l+(data.length===1?plotW/2:plotW*i/(data.length-1));ctx.fillText(monthLabel(x.label),xx,h-pad.b+9);});
    attachChartTooltip(canvas,()=>pts.filter(Boolean),p=>`${monthLabel(p.label)} · ${chartLabel(p.label,p.value,unit,money)}`);
  }

  function drawMultiLineChart(id,data){
    const canvas=$(id);if(!canvas)return;const c=chartBase(canvas),{ctx,w,h,muted,line,accent,pad}=c;
    data = (data || []).filter(x => Number.isFinite(Number(x.actual)) && Number.isFinite(Number(x.target)));
    const vals=data.flatMap(x=>[Number(x.actual),Number(x.target)]).filter(Number.isFinite);
    if(!vals.length){ctx.fillStyle=muted;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("No data yet",w/2,h/2);return;}
    const max=Math.max(...vals,1), yMax=max*1.14, plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;
    for(let i=0;i<4;i++){const y=pad.t+plotH*i/3;ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillStyle=muted;ctx.font="10px system-ui";ctx.textAlign="right";ctx.textBaseline="middle";ctx.fillText(fmtNum(yMax-(yMax/3)*i,0),pad.l-6,y);}
    const makePts=(key,series)=>data.map((x,i)=>({x:pad.l+(data.length===1?plotW/2:plotW*i/(data.length-1)),y:pad.t+(yMax-Number(x[key]))/yMax*plotH,value:Number(x[key]),label:x.label,series}));
    const actual=makePts("actual","Actual"),target=makePts("target","Target");
    [[actual,accent,2],[target,muted,1.5]].forEach(([pts,col,lw])=>{ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();pts.forEach(p=>{ctx.fillStyle=col;ctx.beginPath();ctx.arc(p.x,p.y,2.7,0,Math.PI*2);ctx.fill();});});
    ctx.font="10px system-ui";actual.forEach(p=>{ctx.fillStyle=accent;ctx.textAlign="center";ctx.textBaseline="bottom";ctx.fillText(fmtNum(p.value,0),p.x,Math.max(10,p.y-6));});
    ctx.fillStyle=muted;ctx.textAlign="center";ctx.textBaseline="top";data.forEach((x,i)=>{if(i%Math.max(1,Math.ceil(data.length/6))!==0&&i!==data.length-1)return;ctx.fillText(monthLabel(x.label),actual[i].x,h-pad.b+9);});
    ctx.textAlign="left";ctx.fillStyle=accent;ctx.fillText("● Actual",pad.l,10);ctx.fillStyle=muted;ctx.fillText("● Target",pad.l+65,10);
    attachChartTooltip(canvas,()=>actual.concat(target),p=>`${monthLabel(p.label)} · ${p.series}: ${fmtNum(p.value,0)} km`);
  }

  function attachChartTooltip(canvas,getPoints,format){
    if(canvas.__garageTooltipBound)return; canvas.__garageTooltipBound=true;
    const tip=document.createElement("div");tip.className="chart-tooltip";document.body.appendChild(tip);
    const showTip=e=>{const rect=canvas.getBoundingClientRect(),scaleX=canvas.width/(rect.width||1),scaleY=canvas.height/(rect.height||1),x=(e.clientX-rect.left)*scaleX/(window.devicePixelRatio||1),y=(e.clientY-rect.top)*scaleY/(window.devicePixelRatio||1);const pts=getPoints();let best=null,bd=Infinity;pts.forEach(p=>{const d=Math.hypot(p.x-x,p.y-y);if(d<bd){bd=d;best=p;}});if(best&&bd<28){tip.textContent=format(best);tip.style.left=`${e.clientX+10}px`;tip.style.top=`${e.clientY-34}px`;tip.classList.add("show");}else tip.classList.remove("show");};
    canvas.addEventListener("pointermove",showTip);canvas.addEventListener("pointerleave",()=>tip.classList.remove("show"));canvas.addEventListener("pointerdown",showTip);
  }

  function show(screen){
    ["home","audi","vistiq"].forEach(k=>$(k)?.classList.toggle("active",k===screen));
    document.querySelectorAll(".nav button[data-nav]").forEach(b=>b.classList.toggle("active",b.dataset.nav===screen));
    window.scrollTo({top:0,behavior:"instant"});
    if(screen==="home") drawAllCharts();
  }

  function toast(message){
    const el=$("toast"); if(!el)return;
    el.textContent=message;el.classList.add("show");
    clearTimeout(window.__garageToast);window.__garageToast=setTimeout(()=>el.classList.remove("show"),2200);
  }

  function closeModal(id){$(id)?.classList.remove("show");}
  function openModal(id){$(id)?.classList.add("show");}

  function clearErrors(prefix){
    document.querySelectorAll(`#${prefix} .error.show`).forEach(e=>e.classList.remove("show"));
  }
  function error(id, showIt){$(id)?.classList.toggle("show",!!showIt);}

  function addMileage(){
    clearErrors("vistiq");
    const date=$("vMileageDate")?.value, odo=num($("vMileageOdo")?.value,NaN);
    let bad=false;
    if(!date){error("vMileageDateErr",true);bad=true;}
    if(!Number.isFinite(odo)){error("vMileageOdoErr",true);bad=true;}
    if(bad)return;
    const existing=state.mileage.find(r=>r.vehicle==="vistiq"&&r.date===date);
    if(existing){
      existing.odometer=odo;
      toast("Mileage updated.");
    }else{
      state.mileage.push({id:id(),date,odometer:odo,vehicle:"vistiq",createdAt:new Date().toISOString()});
      toast("Mileage saved.");
    }
    state.settings.vOdo=odo;
    save(); renderAll();
    setVal("vMileageOdo","");
  }

  function addFuel(){
    const date=$("aDate")?.value, odo=num($("aOdo")?.value,NaN), price=num($("aPrice")?.value,NaN), spend=num($("aSpend")?.value,NaN);
    let bad=false;
    if(!date){error("aDateErr",true);bad=true}else error("aDateErr",false);
    if(!Number.isFinite(odo)){error("aOdoErr",true);bad=true}else error("aOdoErr",false);
    if(!Number.isFinite(price)){error("aPriceErr",true);bad=true}else error("aPriceErr",false);
    if(!Number.isFinite(spend)){error("aSpendErr",true);bad=true}else error("aSpendErr",false);
    if(bad)return;
    state.fuel.push({id:id(),date,odometer:odo,pricePerLitre:price,spend,litres:price>0?spend/price:0,vehicle:"audi"});
    save();renderAll();toast("Fill-up saved.");
    ["aOdo","aPrice","aSpend"].forEach(k=>setVal(k,""));
  }

  function addCharge(){
    const date=$("vDate")?.value, kwh=num($("vEnergy")?.value,NaN), rateField=$("vRate")?.value;
    let bad=false;
    if(!date){error("vDateErr",true);bad=true}else error("vDateErr",false);
    if(!Number.isFinite(kwh)){error("vKwhErr",true);bad=true}else error("vKwhErr",false);
    if(bad)return;
    const hasOverride=rateField!==undefined && rateField!==null && String(rateField).trim()!=="";
    const rate=hasOverride?num(rateField,0):state.settings.electricityRate;
    state.charging.push({id:id(),date,kwh,rate,cost:null,vehicle:"vistiq"});
    save();renderAll();toast("Charging session saved.");
    setVal("vKwh",""); setVal("vRate",state.settings.electricityRate);
  }

  function addMaintenanceVehicle(vehicleName){
    const vehicle=vehicleKey(vehicleName);
    const p=vehicle==="audi"?{date:"aMDate",service:"aMType",cost:"aMCost",odo:"aMOdo"}:{date:"vMDate",service:"vMType",cost:"vMCost",odo:"vMOdo"};
    const date=$(p.date)?.value, service=$(p.service)?.value?.trim(), cost=num($(p.cost)?.value,NaN), odo=num($(p.odo)?.value,0);
    let bad=false;
    const errs=vehicle==="audi"?{d:"aMDateErr",s:"aMTypeErr",c:"aMCostErr"}:{d:"vMDateErr",s:"vMTypeErr",c:"vMCostErr"};
    if(!date){error(errs.d,true);bad=true}else error(errs.d,false);
    if(!service){error(errs.s,true);bad=true}else error(errs.s,false);
    if(!Number.isFinite(cost)){error(errs.c,true);bad=true}else error(errs.c,false);
    if(bad)return;
    state.maintenance.push({id:id(),date,service,cost,odometer:odo,vehicle});
    save();renderAll();toast("Maintenance saved.");
    setVal(p.service,"");setVal(p.cost,"");setVal(p.odo,"");
  }

  function deleteHistory(type, recordId){
    const label={fuel:"fill-up",charging:"charging session",mileage:"mileage entry",maintenance:"maintenance record"}[type]||"record";
    if(!confirm(`Delete this ${label}?`)) return;
    const arr=state[type];
    if(!Array.isArray(arr))return;
    const before=arr.length;
    state[type]=arr.filter(r=>String(r.id)!==String(recordId));
    if(state[type].length===before)return;
    if(type==="mileage"){
      const latest=latestMileage("vistiq");
      state.settings.vOdo=latest?.odometer ?? state.settings.vOdo;
    }
    save();renderAll();toast(`${label[0].toUpperCase()+label.slice(1)} deleted.`);
  }

  function calculateWhatIf(){
    const monthly=num($("whatIfKm")?.value,0);
    const current=currentVistiqOdo();
    const days=Math.max(0,(dateMs(state.settings.leaseEnd)-dateMs(todayISO()))/86400000);
    const projected=current+monthly/30.4375*days;
    const excess=Math.max(0,projected-state.settings.allowance);
    setText("whatIfResult",`${fmtNum(projected,1)} km projected • ${fmtNum(excess,1)} km excess • ${fmtMoney(excess*state.settings.excessRate)}`);
    setText("whatIfDetail",`At ${fmtNum(monthly,0)} km/month from today through lease end.`);
  }
  function setWhatIf(v){setVal("whatIfKm",v);calculateWhatIf();}

  function saveSettings(){
    state.settings.allowance=num($("sAllowance")?.value,state.settings.allowance);
    state.settings.leaseStart=dateISO($("sLeaseStart")?.value)||state.settings.leaseStart;
    state.settings.leaseEnd=dateISO($("sLeaseEnd")?.value)||state.settings.leaseEnd;
    state.settings.leaseOdo=num($("sLeaseOdo")?.value,state.settings.leaseOdo);
    state.settings.vOdo=num($("sVodo")?.value,currentVistiqOdo());
    state.settings.excessRate=num($("sVrate")?.value,state.settings.excessRate);
    state.settings.electricityRate=num($("sERate")?.value,state.settings.electricityRate);
    save();renderAll();closeModal("settingsModal");toast("Settings saved.");
  }

  function openSettings(){
    setVal("sAllowance",state.settings.allowance);setVal("sLeaseStart",state.settings.leaseStart);setVal("sLeaseEnd",state.settings.leaseEnd);
    setVal("sLeaseOdo",state.settings.leaseOdo);setVal("sVodo",currentVistiqOdo());setVal("sVrate",state.settings.excessRate);setVal("sERate",state.settings.electricityRate);
    openModal("settingsModal");
  }
  function closeSettings(){closeModal("settingsModal");}

  function exportData(){
    const payload={...state,exportedAt:new Date().toISOString(),formatVersion:"36.1"};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=`garage-backup-${todayISO()}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    toast("Garage backup exported.");
  }

  function importData(event){
    const file=event?.target?.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const parsed=JSON.parse(String(reader.result));
        const imported=normalizeState(parsed);
        const total=imported.mileage.length+imported.fuel.length+imported.charging.length+imported.maintenance.length+imported.customVehicles.length;
        if(!total && !parsed.settings && !parsed.data && !parsed.garageData){
          throw new Error("This file does not look like a Garage JSON backup.");
        }
        state=imported; save(); renderAll(); closeSettings();
        toast(`Imported ${total} Garage records.`);
      }catch(e){
        console.error(e);
        alert(`Could not import JSON: ${e.message||"Invalid JSON file."}`);
      }finally{
        if(event?.target) event.target.value="";
      }
    };
    reader.onerror=()=>{alert("Could not read the JSON file.");if(event?.target)event.target.value="";};
    reader.readAsText(file);
  }

  function toggleTheme(){
    const html=document.documentElement;
    const dark=!html.classList.contains("dark");
    html.classList.toggle("dark",dark);
    try{localStorage.setItem("garageTheme",dark?"dark":"light")}catch(_){}
    drawAllCharts();
  }

  function openQuickCharge(){openModal("quickChargeModal");}
  function closeQuickCharge(){closeModal("quickChargeModal");}
  function saveQuickCharge(){
    const date=$("qChargeDate")?.value,kwh=num($("qChargeKwh")?.value,NaN),rateRaw=$("qChargeRate")?.value;
    if(!date||!Number.isFinite(kwh))return alert("Enter a date and kWh.");
    const rate=String(rateRaw).trim()===""?state.settings.electricityRate:num(rateRaw,0);
    state.charging.push({id:id(),date,kwh,rate,cost:null,vehicle:"vistiq"});save();renderAll();closeQuickCharge();toast("Charging session saved.");
  }
  function openQuickFuel(){openModal("quickFuelModal");}
  function closeQuickFuel(){closeModal("quickFuelModal");}
  function saveQuickFuel(){
    const date=$("qFuelDate")?.value,odo=num($("qFuelOdo")?.value,NaN),price=num($("qFuelPrice")?.value,NaN),spend=num($("qFuelSpend")?.value,NaN);
    if(!date||!Number.isFinite(odo)||!Number.isFinite(price)||!Number.isFinite(spend))return alert("Enter all fuel details.");
    state.fuel.push({id:id(),date,odometer:odo,pricePerLitre:price,spend,litres:price>0?spend/price:0,vehicle:"audi"});
    save();renderAll();closeQuickFuel();toast("Fuel saved.");
  }

  function openInstall(){openModal("installModal");}
  function closeInstall(){closeModal("installModal");}
  async function installGarage(){
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      try{await deferredInstallPrompt.userChoice}catch(_){}
      deferredInstallPrompt=null;
    }else toast("Use your browser menu and choose Install app.");
    closeInstall();
  }

  function openVehicleModal(key){
    const vehicle=state.vehicles[key]||{};
    setText("vehicleModalTitle",vehicle.name||key);
    const content=$("customVehicleContent");
    if(content) content.innerHTML=`<div class="note">${esc(vehicle.ownership||"Owned")} · ${esc(vehicle.power||"gas")}</div>`;
    openModal("vehicleModal");
  }
  function closeVehicleModal(){closeModal("vehicleModal");}
  function saveVehicleFromModal(){closeVehicleModal();}
  function openAddVehicle(){openModal("customVehicleModal");}
  function closeCustomVehicle(){closeModal("customVehicleModal");}

  // Keep inline onclick handlers working after the refactor.
  Object.assign(window,{
    show,toast,addMileage,addFuel,addCharge,addMaintenanceVehicle,deleteHistory,
    calculateWhatIf,setWhatIf,saveSettings,openSettings,closeSettings,exportData,importData,
    toggleTheme,openQuickCharge,closeQuickCharge,saveQuickCharge,openQuickFuel,closeQuickFuel,
    saveQuickFuel,openInstall,closeInstall,installGarage,openVehicleModal,closeVehicleModal,
    saveVehicleFromModal,openAddVehicle,closeCustomVehicle
  });

  window.addEventListener("resize",()=>{clearTimeout(window.__garageResize);window.__garageResize=setTimeout(drawAllCharts,120);});
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;setText("installAppBtn","Install Garage as an app");const b=$("installAppBtn");if(b)b.style.display="block";});
  window.addEventListener("storage",e=>{if(e.key===STORAGE_KEY){state=findStoredState();renderAll();}});
  document.addEventListener("DOMContentLoaded",()=>{
    try{
      const theme=localStorage.getItem("garageTheme");
      if(theme==="dark" || (!theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
    }catch(_){}
    // Modal backdrop close without breaking buttons.
    document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("show");}));
    renderAll();
    show(document.querySelector(".screen.active")?.id || "home");
  });
})();