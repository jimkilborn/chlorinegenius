import { useState, useEffect, useCallback } from "react";

// ─── Fonts ────────────────────────────────────────────────────────────────────
const FontLoader = () => {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
  return null;
};

// ─── Chemistry ────────────────────────────────────────────────────────────────
const minFCforCYA = (cya) => {
  if (cya < 10) return 1;
  if (cya < 30) return 2;
  if (cya < 50) return 3;
  if (cya < 70) return 4;
  if (cya < 90) return 5;
  return 6;
};
const maxFCforCYA = (cya) => {
  if (cya < 10) return 3;
  if (cya < 30) return 5;
  if (cya < 50) return 7;
  if (cya < 70) return 9;
  if (cya < 90) return 11;
  return 13;
};

// 10% NaOCl: 10.65 oz raises 10,000 gal by 1 ppm
const doseOz = (gallons, ppm, conc = 10) => {
  if (ppm <= 0) return 0;
  const ozPer10kPer1ppm = 10.65 * (10 / conc);
  return Math.round((ppm * gallons / 10000) * ozPer10kPer1ppm * 10) / 10;
};

// Base decay rate in ppm per UV-active hour (not per day)
// Sun hours = 8am–8pm = 12 hrs/day. Full daily rate ÷ 12 = hourly UV rate.
// Nighttime residual = 10% of hourly rate (temp-driven chemical breakdown, no UV).
const calcHourlyDecay = ({ uvIndex = 5, tempF = 85, shadeFactor = 1.0, cya = 30, multiplier = 1.0 }) => {
  const uv   = Math.max(0.15, uvIndex / 6);
  const temp = Math.max(0.4,  (tempF - 45) / 55);
  const cya_ = Math.max(0.25, 1 - cya / 220);
  const dailyRate = 1.3 * uv * temp * shadeFactor * cya_ * multiplier;
  return {
    sunHour:   dailyRate / 12,       // ppm lost per hour of sunlight (8am–8pm)
    nightHour: (dailyRate / 12) * 0.10, // ppm lost per hour overnight
  };
};

// Sun hours: 8am–8pm local time (hour 8–20)
const SUN_START = 8;
const SUN_END   = 20;

// Calculate weighted ppm loss between two Date objects
const sunWeightedLoss = (startDate, endDate, decayParams) => {
  const { sunHour, nightHour } = calcHourlyDecay(decayParams);
  let loss = 0;
  let cursor = new Date(startDate);
  const end  = new Date(endDate);
  // Walk hour by hour (cap at 240h = 10 days to prevent runaway)
  const maxHours = Math.min(240, Math.ceil((end - cursor) / 3600000));
  for (let i = 0; i < maxHours; i++) {
    const next = new Date(Math.min(cursor.getTime() + 3600000, end.getTime()));
    const frac = (next - cursor) / 3600000; // fraction of this hour elapsed
    const hr   = cursor.getHours();
    loss += frac * (hr >= SUN_START && hr < SUN_END ? sunHour : nightHour);
    cursor = next;
    if (cursor >= end) break;
  }
  return loss;
};

// Daily rate for display purposes (full sun day, 12 sun hours)
const calcDecayPerDay = (params) => {
  const { sunHour, nightHour } = calcHourlyDecay(params);
  return Math.round((sunHour * 12 + nightHour * 12) * 100) / 100;
};

const SHADE = {
  full:    { label: "Full Sun",      desc: "6+ hrs direct sun",      factor: 1.00 },
  partial: { label: "Partial Shade", desc: "3–6 hrs direct sun",     factor: 0.62 },
  heavy:   { label: "Heavy Shade",   desc: "Under 3 hrs direct sun", factor: 0.30 },
};

// ─── Storage (localStorage) ───────────────────────────────────────────────────
const store = {
  get(key)       { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, val)  { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  del(key)       { try { localStorage.removeItem(key); } catch {} },
};

// ─── Location ─────────────────────────────────────────────────────────────────
function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("GPS not available")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, city: "My Location" }),
      err => reject(new Error(err.code === 1 ? "Location permission denied" : "GPS unavailable")),
      { timeout: 10000, enableHighAccuracy: false }
    );
  });
}

async function geocodeZip(zip) {
  const r = await fetch(`https://api.zippopotam.us/us/${zip.trim()}`);
  if (!r.ok) throw new Error(`ZIP ${zip} not found`);
  const d = await r.json();
  const place = d.places?.[0];
  if (!place) throw new Error("No location data for that ZIP");
  return {
    lat:  parseFloat(place.latitude),
    lon:  parseFloat(place.longitude),
    city: `${place["place name"]}, ${place["state abbreviation"]}`,
  };
}

// ─── Weather ──────────────────────────────────────────────────────────────────
function seasonalWeather(lat) {
  const doy   = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const angle = ((doy - 172) / 365) * 2 * Math.PI;
  const lf    = Math.max(0.3, 1 - Math.abs(lat - 25) / 60);
  const tempF = Math.round((55 + 40 * lf) - (20 * lf) * Math.cos(angle));
  const uvIndex = Math.round(((8 * lf) - (4 * lf) * Math.cos(angle)) * 10) / 10;
  return { uvIndex, tempF, cloudCover: 35, estimated: true };
}

async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=uv_index_max,cloud_cover_mean,temperature_2m_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
    const r = await Promise.race([fetch(url), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return {
      uvIndex:    Math.round(d.daily.uv_index_max[0]  * 10) / 10,
      cloudCover: Math.round(d.daily.cloud_cover_mean[0]),
      tempF:      Math.round(d.daily.temperature_2m_max[0]),
      estimated:  false,
    };
  } catch { return seasonalWeather(lat); }
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#070e1c", panel: "#0c1525", border: "#162338",
  accent: "#00d4e8", accentLo: "#00526b",
  text: "#cce4ef", muted: "#4e6e82",
  good: "#00e088", warn: "#ffb820", danger: "#ff3f5e",
};
const S = {
  app:    { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'IBM Plex Mono', monospace", paddingBottom: "72px" },
  header: { padding: "18px 20px 14px", borderBottom: `1px solid ${C.border}`, background: C.panel, display: "flex", alignItems: "center", justifyContent: "space-between" },
  title:  { fontFamily: "'Syne', sans-serif", fontSize: "21px", fontWeight: 800, color: C.accent, letterSpacing: "-0.5px", margin: 0 },
  sub:    { fontSize: "10px", color: C.muted, marginTop: "2px", letterSpacing: "0.5px" },
  content:{ padding: "16px" },
  card:   { background: C.panel, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px", marginBottom: "12px" },
  cap:    { fontSize: "9px", color: C.muted, letterSpacing: "2px", textTransform: "uppercase", marginBottom: "10px" },
  bigNum: { fontFamily: "'Syne', sans-serif", fontWeight: 800, lineHeight: 1 },
  input:  { width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 12px", color: C.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: "14px", outline: "none", boxSizing: "border-box" },
  btn:    { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "9px 18px", borderRadius: "8px", border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: "12px", fontWeight: 600, transition: "opacity 0.15s" },
  primary:{ background: C.accent, color: C.bg },
  ghost:  { background: "transparent", color: C.accent, border: `1px solid ${C.accentLo}` },
  nav:    { position: "fixed", bottom: 0, left: 0, right: 0, background: C.panel, borderTop: `1px solid ${C.border}`, display: "flex", padding: "8px 0 18px" },
  navBtn: { flex: 1, background: "none", border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", padding: "6px 0" },
};

const Btn  = ({ primary, ghost, style = {}, ...p }) => <button style={{ ...S.btn, ...(primary ? S.primary : ghost ? S.ghost : {}), ...style }} {...p} />;
const Card = ({ style = {}, ...p }) => <div style={{ ...S.card, ...style }} {...p} />;
const Cap  = (p) => <div style={S.cap} {...p} />;

// ─── App ──────────────────────────────────────────────────────────────────────
export default function PoolApp() {
  const [screen,  setScreen]  = useState("loading");
  const [config,  setConfig]  = useState(null);
  const [meas,    setMeas]    = useState([]);
  const [model,   setModel]   = useState({ multiplier: 1.0 });
  const [weather, setWeather] = useState(null);

  // Wizard
  const [step, setStep] = useState(0);
  const [wiz,  setWiz]  = useState({ gallons: "", cya: "30", shade: "full", zip: "", lat: "", lon: "", city: "", locSet: false, targetFC: "", conc: "10" });
  const [geoErr,  setGeoErr]  = useState("");
  const [geoLoad, setGeoLoad] = useState(false);

  // Log
  const [log, setLog] = useState({ fc: "", bathers: 0, notes: "" });

  // Dose confirmation — shown after logging when a dose is recommended
  const [pendingEntry, setPendingEntry] = useState(null); // the just-logged measurement
  const [pendingDose,  setPendingDose]  = useState(0);    // recommended oz
  const [customOz,     setCustomOz]     = useState("");   // user override

  // Retroactive dose correction
  const [correctingDose, setCorrectingDose] = useState(false);
  const [correctionFC,   setCorrectionFC]   = useState("");

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cfg  = store.get("pool-config");
    const ms   = store.get("measurements");
    const mdl  = store.get("decay-model");
    if (cfg) {
      setConfig(cfg); setMeas(ms || []); setModel(mdl || { multiplier: 1.0 });
      setScreen("dashboard");
      fetchWeather(cfg.lat, cfg.lon).then(setWeather);
    } else {
      setScreen("setup");
    }
  }, []);

  // ── Effective temp (heater aware) ─────────────────────────────────────────
  const effectiveTempF = useCallback(() => {
    const airTemp = weather?.tempF ?? 85;
    if (config?.heaterOn && config?.heaterTemp) return Math.max(airTemp, config.heaterTemp);
    return airTemp;
  }, [weather, config]);

  // ── Prediction ────────────────────────────────────────────────────────────
  const prediction = useCallback(() => {
    if (!meas.length || !config) return null;
    const last = meas[meas.length - 1];
    const startDate = new Date(last.date);
    const nowDate   = new Date();
    const daysSince = (nowDate - startDate) / 86400000;
    if (daysSince > 10) return null;
    const baseFC  = last.effectiveFC ?? last.fc;
    const shade   = SHADE[config.shade]?.factor ?? 1.0;
    const params  = { uvIndex: weather?.uvIndex ?? 5, tempF: effectiveTempF(), shadeFactor: shade, cya: config.cya, multiplier: model.multiplier };
    const loss    = sunWeightedLoss(startDate, nowDate, params);
    const ratePerDay = calcDecayPerDay(params);
    const fc      = Math.max(0, Math.round((baseFC - loss) * 10) / 10);
    // If predicted FC has hit zero the model has no reliable baseline — flag it
    const depleted = fc <= 0;
    return {
      fc, depleted,
      days:    Math.round(daysSince * 10) / 10,
      rate:    ratePerDay,
      dosed:   !!last.effectiveFC,
      dosedTo: last.effectiveFC,
    };
  }, [meas, config, weather, model, effectiveTempF]);

  // ── Save config ───────────────────────────────────────────────────────────
  const finishSetup = async () => {
    setGeoErr(""); setGeoLoad(true);
    try {
      let lat = parseFloat(wiz.lat), lon = parseFloat(wiz.lon), city = wiz.city;
      if (!lat || !lon) throw new Error("No location set");
      const minFC = minFCforCYA(parseInt(wiz.cya));
      const cfg = {
        gallons: parseInt(wiz.gallons), cya: parseInt(wiz.cya), shade: wiz.shade,
        zip: wiz.zip, lat, lon, city,
        targetFC: parseFloat(wiz.targetFC) || (minFC + 1),
        conc: parseFloat(wiz.conc),
      };
      store.set("pool-config", cfg);
      setConfig(cfg); setScreen("dashboard");
      fetchWeather(lat, lon).then(setWeather);
    } catch (e) { setGeoErr(e.message); }
    finally { setGeoLoad(false); }
  };

  // ── Locate by ZIP ─────────────────────────────────────────────────────────
  const lookupZip = async () => {
    if (!wiz.zip || wiz.zip.length < 5) { setGeoErr("Enter a 5-digit ZIP first"); return; }
    setGeoErr(""); setGeoLoad(true);
    try {
      const geo = await geocodeZip(wiz.zip);
      setWiz(d => ({ ...d, lat: geo.lat, lon: geo.lon, city: geo.city, locSet: true }));
    } catch (e) { setGeoErr(e.message); }
    finally { setGeoLoad(false); }
  };

  // ── Locate by GPS ─────────────────────────────────────────────────────────
  const useGPS = async () => {
    setGeoErr(""); setGeoLoad(true);
    try {
      const geo = await getBrowserLocation();
      setWiz(d => ({ ...d, lat: geo.lat, lon: geo.lon, city: geo.city, locSet: true }));
    } catch (e) { setGeoErr(e.message); }
    finally { setGeoLoad(false); }
  };

  // ── Save measurement ──────────────────────────────────────────────────────
  const updateDecayModel = (priorMeas, measuredFC) => {
    if (!priorMeas) return;
    const startDate = new Date(priorMeas.date);
    const nowDate   = new Date();
    const startFC   = priorMeas.effectiveFC ?? priorMeas.fc;
    const actualLoss = startFC - measuredFC;
    if (actualLoss <= 0) return; // FC went up (chlorine was added externally) — skip
    const shade = SHADE[config.shade]?.factor ?? 1.0;
    // What would baseline model (multiplier=1) have predicted for this exact window?
    const baseParams = { uvIndex: weather?.uvIndex ?? 5, tempF: effectiveTempF(), shadeFactor: shade, cya: config.cya, multiplier: 1.0 };
    const baseLoss = sunWeightedLoss(startDate, nowDate, baseParams);
    if (baseLoss <= 0) return;
    // Observed multiplier = actual loss / what baseline predicted
    const observed = actualLoss / baseLoss;
    const newMult  = Math.min(3.5, Math.max(0.2, model.multiplier * 0.65 + observed * 0.35));
    const newModel = { multiplier: Math.round(newMult * 1000) / 1000, updated: new Date().toISOString() };
    setModel(newModel);
    store.set("decay-model", newModel);
  };

  const saveLog = () => {
    const fc = parseFloat(log.fc);
    if (isNaN(fc) || fc < 0) return;
    const pred  = prediction();
    const entry = { id: Date.now(), date: new Date().toISOString(), fc, predictedFC: pred?.fc ?? null, bathers: log.bathers, notes: log.notes, uvIndex: weather?.uvIndex, tempF: weather?.tempF };
    const prior = meas.length > 0 ? meas[meas.length - 1] : null;

    // Update decay model from prior → this measurement
    updateDecayModel(prior, fc);

    // Save measurement
    const newMeas = [...meas, entry];
    setMeas(newMeas);
    store.set("measurements", newMeas);
    setLog({ fc: "", bathers: 0, notes: "" });

    // Calculate recommended dose — if nonzero, go to dose confirm screen
    const maxFC = maxFCforCYA(config.cya);
    const needed = Math.max(0, maxFC - fc);
    const recommendedOz = doseOz(config.gallons, needed, config.conc);
    if (recommendedOz > 0) {
      setPendingEntry(entry);
      setPendingDose(recommendedOz);
      setCustomOz("");
      setScreen("doseConfirm");
    } else {
      setPendingEntry(null);
      setScreen("dashboard");
    }
  };

  // ── Confirm dose was added ────────────────────────────────────────────────
  const confirmDose = (ozAdded) => {
    if (!pendingEntry) { setScreen("dashboard"); return; }
    // Convert oz added → ppm gained
    const ozPer10kPer1ppm = 10.65 * (10 / config.conc);
    const ppmAdded = (ozAdded / ozPer10kPer1ppm) * (10000 / config.gallons);
    const effectiveFC = Math.round((pendingEntry.fc + ppmAdded) * 10) / 10;

    // Update the entry with effectiveFC so predictions use post-dose level
    const updated = meas.map(m => m.id === pendingEntry.id ? { ...m, effectiveFC, ozAdded: Math.round(ozAdded * 10) / 10 } : m);
    setMeas(updated);
    store.set("measurements", updated);
    setPendingEntry(null);
    setScreen("dashboard");
  };

  const skipDose = () => {
    setPendingEntry(null);
    setScreen("dashboard");
  };

  // ─── Nav ──────────────────────────────────────────────────────────────────
  const Nav = () => (
    <div style={S.nav}>
      {[["dashboard","POOL"],["log","LOG"],["history","HISTORY"],["settings","SETUP"]].map(([s, l]) => (
        <button key={s} style={{ ...S.navBtn, color: screen === s ? C.accent : C.muted }} onClick={() => setScreen(s)}>{l}</button>
      ))}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // DOSE CONFIRMATION
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === "doseConfirm" && pendingEntry) {
    const maxFC = maxFCforCYA(config.cya);
    const ozPer10kPer1ppm = 10.65 * (10 / config.conc);
    const customPpm = customOz ? Math.round(((parseFloat(customOz) / ozPer10kPer1ppm) * (10000 / config.gallons)) * 10) / 10 : 0;
    const customEffectiveFC = Math.round((pendingEntry.fc + customPpm) * 10) / 10;

    return (
      <div style={S.app}>
        <FontLoader />
        <div style={S.header}>
          <div>
            <div style={S.title}>CHLOR.IO</div>
            <div style={S.sub}>Did you add chlorine?</div>
          </div>
        </div>
        <div style={S.content}>

          <Card style={{ borderColor: `${C.accent}55` }}>
            <Cap>MEASURED FC</Cap>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "6px" }}>
              <div style={{ ...S.bigNum, fontSize: "36px", color: C.warn }}>{pendingEntry.fc}</div>
              <div style={{ color: C.muted, fontSize: "14px" }}>ppm</div>
              <div style={{ color: C.muted, fontSize: "12px", marginLeft: "4px" }}>→ target {maxFC} ppm</div>
            </div>
            <div style={{ fontSize: "11px", color: C.accent }}>
              Recommended: <strong>{pendingDose} oz</strong> of {config.conc}% liquid chlorine
            </div>
          </Card>

          {/* Option 1 — added full recommended dose */}
          <Card
            style={{ cursor: "pointer", borderColor: `${C.good}44` }}
            onClick={() => confirmDose(pendingDose)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "13px", color: C.good, fontWeight: 600 }}>✓ Yes — added {pendingDose} oz</div>
                <div style={{ fontSize: "10px", color: C.muted, marginTop: "4px" }}>
                  Effective FC: {Math.round((pendingEntry.fc + (pendingDose / ozPer10kPer1ppm) * (10000 / config.gallons)) * 10) / 10} ppm → predictions update from this level
                </div>
              </div>
              <div style={{ fontSize: "20px", color: C.good }}>→</div>
            </div>
          </Card>

          {/* Option 2 — added a different amount */}
          <Card style={{ borderColor: `${C.accent}33` }}>
            <Cap>ADDED A DIFFERENT AMOUNT</Cap>
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <input
                style={{ ...S.input, flex: 1 }}
                type="number" step="0.5" min="0"
                placeholder={`oz of ${config.conc}% chlorine`}
                value={customOz}
                onChange={e => setCustomOz(e.target.value)}
              />
              <Btn primary
                style={{ flexShrink: 0, opacity: customOz && parseFloat(customOz) > 0 ? 1 : 0.35 }}
                onClick={() => { if (customOz && parseFloat(customOz) > 0) confirmDose(parseFloat(customOz)); }}>
                Confirm
              </Btn>
            </div>
            {customOz && parseFloat(customOz) > 0 && (
              <div style={{ fontSize: "10px", color: C.muted }}>
                Adds ~{customPpm} ppm → effective FC: <span style={{ color: C.accent }}>{customEffectiveFC} ppm</span>
              </div>
            )}
          </Card>

          {/* Option 3 — didn't add */}
          <Btn ghost style={{ width: "100%" }} onClick={skipDose}>
            Not adding chlorine right now
          </Btn>
          <div style={{ fontSize: "10px", color: C.muted, textAlign: "center", marginTop: "8px" }}>
            Skipping will base predictions on your measured {pendingEntry.fc} ppm only
          </div>

        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOADING
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === "loading") return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <FontLoader />
      <div style={{ color: C.muted, fontSize: "12px" }}>Loading…</div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SETUP WIZARD
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === "setup") {
    const minFC = minFCforCYA(parseInt(wiz.cya) || 0);
    const steps = [
      // 0 — volume
      <>
        <Cap>POOL VOLUME</Cap>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
          {[10000, 15000, 18000, 20000].map(g => (
            <Btn key={g} primary={wiz.gallons == g} ghost={wiz.gallons != g} style={{ width: "100%" }}
              onClick={() => setWiz(v => ({ ...v, gallons: g }))}>{g.toLocaleString()} gal</Btn>
          ))}
        </div>
        <Cap>OR TYPE EXACT</Cap>
        <input style={S.input} type="number" placeholder="e.g. 22500"
          value={wiz.gallons} onChange={e => setWiz(v => ({ ...v, gallons: e.target.value }))} />
      </>,

      // 1 — CYA
      <>
        <Cap>CYA / STABILIZER (PPM)</Cap>
        <div style={{ fontSize: "11px", color: C.muted, marginBottom: "10px" }}>Test with a drop kit or strips. Typical: 30–50 ppm.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
          {[0, 20, 30, 40, 50, 70, 100].map(v => (
            <Btn key={v} primary={wiz.cya == v} ghost={wiz.cya != v} onClick={() => setWiz(d => ({ ...d, cya: v }))}>{v}</Btn>
          ))}
        </div>
        <input style={S.input} type="number" placeholder="Custom ppm" value={wiz.cya}
          onChange={e => setWiz(d => ({ ...d, cya: e.target.value }))} />
        <div style={{ marginTop: "10px", padding: "8px 12px", background: C.bg, borderRadius: "8px", fontSize: "11px", color: C.accent }}>
          Safe FC range for CYA {wiz.cya || 0}: <strong>{minFC} – {maxFCforCYA(parseInt(wiz.cya) || 0)} ppm</strong>
        </div>
      </>,

      // 2 — shade
      <>
        <Cap>TYPICAL SUN EXPOSURE</Cap>
        {Object.entries(SHADE).map(([k, v]) => (
          <Btn key={k} primary={wiz.shade === k} ghost={wiz.shade !== k}
            style={{ width: "100%", marginBottom: "8px", flexDirection: "column", alignItems: "flex-start", padding: "10px 14px", gap: "2px" }}
            onClick={() => setWiz(d => ({ ...d, shade: k }))}>
            <span>{v.label}</span>
            <span style={{ fontSize: "10px", opacity: 0.65 }}>{v.desc}</span>
          </Btn>
        ))}
      </>,

      // 3 — location
      <>
        <Cap>YOUR LOCATION</Cap>
        <Btn primary style={{ width: "100%", marginBottom: "10px", opacity: geoLoad ? 0.5 : 1 }} onClick={useGPS}>
          {geoLoad ? "Locating…" : "📍 Use GPS Location"}
        </Btn>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <input style={{ ...S.input, flex: 1 }} type="text" inputMode="numeric" placeholder="ZIP code"
            value={wiz.zip} onChange={e => setWiz(d => ({ ...d, zip: e.target.value, locSet: false }))}
            onKeyDown={e => e.key === "Enter" && lookupZip()} />
          <Btn ghost style={{ flexShrink: 0, opacity: geoLoad ? 0.5 : 1 }} onClick={lookupZip}>
            {geoLoad ? "…" : "Look up"}
          </Btn>
        </div>
        {wiz.locSet && (
          <div style={{ fontSize: "11px", color: C.good, marginBottom: "8px" }}>
            ✓ {wiz.city} ({parseFloat(wiz.lat).toFixed(3)}, {parseFloat(wiz.lon).toFixed(3)})
          </div>
        )}
        {geoErr && <div style={{ fontSize: "11px", color: C.danger, marginBottom: "8px" }}>{geoErr}</div>}

        <Cap style={{ marginTop: "12px" }}>TARGET FREE CHLORINE</Cap>
        <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>
          Safe range for your CYA: {minFC} – {maxFCforCYA(parseInt(wiz.cya) || 0)} ppm. App will always dose to the top.
        </div>
        <Cap style={{ marginTop: "10px" }}>PRODUCT CONCENTRATION</Cap>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[6, 8.25, 10, 12].map(c => (
            <Btn key={c} primary={wiz.conc == c} ghost={wiz.conc != c} onClick={() => setWiz(d => ({ ...d, conc: c }))}>{c}%</Btn>
          ))}
        </div>
      </>,
    ];

    const valid = [
      () => wiz.gallons > 0,
      () => wiz.cya !== "",
      () => !!wiz.shade,
      () => wiz.locSet,
    ];

    return (
      <div style={S.app}>
        <FontLoader />
        <div style={S.header}>
          <div>
            <div style={S.title}>CHLOR.IO</div>
            <div style={S.sub}>Pool setup — step {step + 1} of {steps.length}</div>
          </div>
          <div style={{ color: C.muted, fontSize: "11px" }}>{Math.round((step / steps.length) * 100)}%</div>
        </div>
        <div style={{ height: "3px", background: C.border }}>
          <div style={{ height: "100%", width: `${((step + 1) / steps.length) * 100}%`, background: C.accent, transition: "width 0.3s" }} />
        </div>
        <div style={S.content}>
          <Card>{steps[step]}</Card>
          <div style={{ display: "flex", gap: "10px" }}>
            {step > 0 && <Btn ghost style={{ flex: 1 }} onClick={() => setStep(s => s - 1)}>← Back</Btn>}
            <Btn primary
              style={{ flex: 2, opacity: valid[step]() ? 1 : 0.35 }}
              onClick={() => { if (!valid[step]()) return; step < steps.length - 1 ? setStep(s => s + 1) : finishSetup(); }}>
              {step < steps.length - 1 ? "Continue →" : geoLoad ? "Saving…" : "Save Pool ✓"}
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === "dashboard") {
    const pred   = prediction();
    const minFC  = config ? minFCforCYA(config.cya) : 1;
    const maxFC  = config ? maxFCforCYA(config.cya) : 5;
    const status = !pred ? "unknown" : pred.depleted ? "depleted" : pred.fc >= minFC ? "good" : pred.fc >= (minFC * 0.75) ? "low" : "critical";
    const fcColor = { good: C.good, low: C.warn, critical: C.danger, depleted: C.danger, unknown: C.muted }[status];
    const needed = (pred && !pred.depleted) ? Math.max(0, maxFC - pred.fc) : 0;
    const dose   = config ? doseOz(config.gallons, needed, config.conc) : 0;
    const last   = meas.length ? meas[meas.length - 1] : null;

    return (
      <div style={S.app}>
        <FontLoader />
        <div style={S.header}>
          <div>
            <div style={S.title}>CHLOR.IO</div>
            <div style={S.sub}>{config.city} · {config.gallons.toLocaleString()} gal</div>
          </div>
          <Btn ghost style={{ padding: "6px 12px", fontSize: "10px" }} onClick={() => setScreen("log")}>+ LOG FC</Btn>
        </div>
        <div style={S.content}>

          {/* FC prediction */}
          <Card style={{ borderColor: pred ? `${fcColor}55` : C.border }}>
            <Cap>ESTIMATED FREE CHLORINE</Cap>
            {pred ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <div style={{ ...S.bigNum, fontSize: "52px", color: fcColor }}>{pred.fc}</div>
                  <div style={{ color: C.muted, fontSize: "18px", paddingBottom: "6px" }}>ppm</div>
                </div>
                <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ fontSize: "11px", color: C.muted }}>safe range:</div>
                  <div style={{ fontSize: "11px" }}>
                    <span style={{ color: C.good }}>{minFC}</span>
                    <span style={{ color: C.muted }}> – </span>
                    <span style={{ color: C.accent }}>{maxFC} ppm</span>
                  </div>
                </div>
                <div style={{ fontSize: "10px", color: C.muted, marginTop: "4px" }}>
                  {pred.dosed
                    ? <>Dosed to <span style={{color:C.accent}}>{pred.dosedTo} ppm</span> · {pred.days}d ago · ~{pred.rate} ppm/sunny day</>
                    : <>Measured {pred.days}d ago · ~{pred.rate} ppm/sunny day</>
                  }
                </div>
                <div style={{ marginTop: "10px", padding: "8px 12px", background: C.bg, borderRadius: "8px", fontSize: "11px", color: fcColor }}>
                  {{ good: `✓ In range — dose to ${maxFC} ppm tonight`, low: "↓ Getting low — add chlorine soon", critical: "⚠ Below safe minimum — add immediately", depleted: "⛔ Predicted FC has reached zero — test your water before adding chlorine" }[status]}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "13px", color: C.muted, marginBottom: "12px" }}>
                  {meas.length === 0 ? "No measurements yet. Test your water and log your first reading." : "Last reading is over 10 days old. Test your water."}
                </div>
                <Btn primary onClick={() => setScreen("log")}>Log first measurement →</Btn>
              </>
            )}
          </Card>

          {/* Depleted — require fresh test */}
          {pred?.depleted && (
            <Card style={{ borderColor: `${C.danger}66`, background: `${C.danger}08` }}>
              <Cap style={{ color: C.danger }}>TEST REQUIRED BEFORE DOSING</Cap>
              <div style={{ fontSize: "13px", color: C.text, marginBottom: "10px" }}>
                The model has lost track of your chlorine level — it's estimated down to 0 ppm. Adding chlorine without a fresh reading risks over- or under-dosing.
              </div>
              <div style={{ fontSize: "11px", color: C.muted, marginBottom: "14px" }}>
                Test your water with a kit or strips, then log the result. The app will calculate the correct dose from that fresh reading.
              </div>
              <Btn primary style={{ width: "100%" }} onClick={() => setScreen("log")}>
                Test & Log FC Now →
              </Btn>
            </Card>
          )}

          {/* Dose recommendation */}
          {pred && !pred.depleted && needed > 0.05 && (() => {
            // Project forward using sun-weighted loss from NOW
            const shade   = SHADE[config.shade]?.factor ?? 1.0;
            const params  = { uvIndex: weather?.uvIndex ?? 5, tempF: effectiveTempF(), shadeFactor: shade, cya: config.cya, multiplier: model.multiplier };
            const now24   = new Date(Date.now() + 24 * 3600000);
            const now36   = new Date(Date.now() + 36 * 3600000);
            const loss24  = sunWeightedLoss(new Date(), now24, params);
            const loss36  = sunWeightedLoss(new Date(), now36, params);
            const fc24h   = Math.max(0, Math.round((maxFC - loss24) * 10) / 10);
            const fc36h   = Math.max(0, Math.round((maxFC - loss36) * 10) / 10);
            const ok24    = fc24h >= minFC;
            const ok36    = fc36h >= minFC;
            return (
              <Card>
                <Cap>RECOMMENDED DOSE</Cap>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                  <div style={{ ...S.bigNum, fontSize: "40px", color: C.accent }}>{dose}</div>
                  <div style={{ color: C.muted, fontSize: "13px", paddingBottom: "4px" }}>oz of {config.conc}% liquid chlorine</div>
                </div>
                <div style={{ fontSize: "11px", color: C.muted, marginTop: "4px" }}>
                  Raises ~{pred.fc} → <span style={{ color: C.accent }}>{maxFC} ppm</span> (top of range) · {config.gallons.toLocaleString()} gal
                </div>
                {dose > 0 && (
                  <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                    = {(dose / 128).toFixed(2)} gal{dose > 128 ? " — split over 2 days" : ""}
                  </div>
                )}
                <div style={{ marginTop: "12px", borderTop: `1px solid ${C.border}`, paddingTop: "10px" }}>
                  <Cap>PROJECTED AFTER DOSING</Cap>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {[["Tomorrow", fc24h, ok24], ["+36 hrs", fc36h, ok36], ["Sunny day rate", pred.rate, true]].map(([lbl, val, ok]) => (
                      <div key={lbl} style={{ flex: 1, background: C.bg, borderRadius: "8px", padding: "8px", textAlign: "center" }}>
                        <div style={{ fontSize: "20px", fontWeight: 700, color: lbl === "Sunny day rate" ? C.text : ok ? C.good : C.danger }}>{val}</div>
                        <div style={{ fontSize: "9px", color: C.muted, marginTop: "2px" }}>{lbl}</div>
                        {lbl !== "Sunny day rate" && <div style={{ fontSize: "9px", color: ok ? C.good : C.danger, marginTop: "2px" }}>{ok ? "✓ safe" : "⚠ low"}</div>}
                      </div>
                    ))}
                  </div>
                  {(!ok24 || !ok36) && (
                    <div style={{ marginTop: "8px", fontSize: "11px", color: C.warn, padding: "6px 10px", background: `${C.warn}15`, borderRadius: "6px" }}>
                      ⚠ Consider dosing to {Math.round((maxFC + pred.rate * 1.5) * 10) / 10} ppm to stay above {minFC} ppm for 36+ hrs
                    </div>
                  )}
                </div>
              </Card>
            );
          })()}

          {pred && !pred.depleted && needed <= 0.05 && (() => {
            const shade   = SHADE[config.shade]?.factor ?? 1.0;
            const params  = { uvIndex: weather?.uvIndex ?? 5, tempF: effectiveTempF(), shadeFactor: shade, cya: config.cya, multiplier: model.multiplier };
            const now24   = new Date(Date.now() + 24 * 3600000);
            const now36   = new Date(Date.now() + 36 * 3600000);
            const fc24h   = Math.max(0, Math.round((pred.fc - sunWeightedLoss(new Date(), now24, params)) * 10) / 10);
            const fc36h   = Math.max(0, Math.round((pred.fc - sunWeightedLoss(new Date(), now36, params)) * 10) / 10);
            return (
              <Card style={{ borderColor: fc24h >= minFC ? `${C.good}44` : `${C.warn}44` }}>
                <div style={{ fontSize: "12px", color: C.good }}>✓ In safe range — no dose needed now</div>
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  {[["Tomorrow", fc24h], ["+36 hrs", fc36h], ["Sunny day rate", pred.rate]].map(([lbl, val]) => (
                    <div key={lbl} style={{ flex: 1, background: C.bg, borderRadius: "8px", padding: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: lbl === "Sunny day rate" ? C.muted : val >= minFC ? C.good : C.warn }}>{val}</div>
                      <div style={{ fontSize: "9px", color: C.muted, marginTop: "2px" }}>{lbl}</div>
                    </div>
                  ))}
                </div>
                {fc36h < minFC && (
                  <div style={{ marginTop: "8px", fontSize: "11px", color: C.warn, padding: "6px 10px", background: `${C.warn}15`, borderRadius: "6px" }}>
                    ⚠ Will drop below {minFC} ppm within 36 hrs — dose to {maxFC} ppm tonight
                  </div>
                )}
              </Card>
            );
          })()}

          {/* Weather */}
          <Card>
            <Cap>TODAY'S CONDITIONS</Cap>
            {weather ? (
              <>
                {weather.estimated && (
                  <div style={{ fontSize: "9px", color: C.warn, marginBottom: "8px", letterSpacing: "1px" }}>
                    ⚡ SEASONAL ESTIMATE
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px" }}>
                  {[["UV Index", weather.uvIndex], ["Air °F", weather.tempF], ["Cloud %", `${weather.cloudCover}%`], ["Pool ×", model.multiplier.toFixed(2)]].map(([lbl, val]) => (
                    <div key={lbl} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "20px", fontWeight: 600, color: weather.estimated ? C.muted : C.text }}>{val}</div>
                      <div style={{ fontSize: "9px", color: C.muted, marginTop: "2px", letterSpacing: "0.5px" }}>{lbl}</div>
                    </div>
                  ))}
                </div>
                {config.heaterOn && config.heaterTemp && (
                  <div style={{ marginTop: "10px", padding: "7px 10px", background: C.bg, borderRadius: "7px", fontSize: "11px", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: C.warn }}>🔥 Heater {config.heaterTemp}°F</span>
                    <span style={{ color: C.muted }}>effective {effectiveTempF()}°F</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: "11px", color: C.muted }}>Fetching weather…</div>
            )}
          </Card>

          {/* Last log */}
          {last && (
            <Card>
              <Cap>LAST MEASUREMENT</Cap>
              <div style={{ fontSize: "13px" }}>
                <span style={{ color: C.accent, fontWeight: 600 }}>{last.fc} ppm FC</span>
                <span style={{ color: C.muted }}> · {new Date(last.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
              {last.effectiveFC ? (
                <div style={{ fontSize: "11px", color: C.accent, marginTop: "6px" }}>
                  ✓ Dosed to {last.effectiveFC} ppm · predictions use this as baseline
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "11px", color: C.warn, marginTop: "6px" }}>
                    No dose recorded — did you add chlorine after this reading?
                  </div>
                  {!correctingDose ? (
                    <Btn ghost style={{ marginTop: "8px", fontSize: "10px", padding: "5px 12px" }}
                      onClick={() => { setCorrectingDose(true); setCorrectionFC(""); }}>
                      + Record a dose
                    </Btn>
                  ) : (
                    <div style={{ marginTop: "10px" }}>
                      <Cap>WHAT DID YOU DOSE TO? (PPM)</Cap>
                      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                        {[maxFCforCYA(config.cya), maxFCforCYA(config.cya) - 1, maxFCforCYA(config.cya) - 2].map(v => (
                          <Btn key={v} primary={correctionFC==v} ghost={correctionFC!=v}
                            onClick={() => setCorrectionFC(v)}>{v} ppm</Btn>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input style={{ ...S.input, flex: 1 }} type="number" step="0.5" placeholder="Custom ppm"
                          value={correctionFC} onChange={e => setCorrectionFC(e.target.value)} />
                        <Btn primary
                          style={{ flexShrink: 0, opacity: correctionFC && parseFloat(correctionFC) > 0 ? 1 : 0.4 }}
                          onClick={() => {
                            const fc = parseFloat(correctionFC);
                            if (!fc || fc <= 0) return;
                            // Patch effectiveFC onto the last measurement
                            const updated = meas.map((m, i) =>
                              i === meas.length - 1 ? { ...m, effectiveFC: fc, ozAdded: "manual" } : m
                            );
                            setMeas(updated);
                            store.set("measurements", updated);
                            setCorrectingDose(false);
                            setCorrectionFC("");
                          }}>
                          Save ✓
                        </Btn>
                      </div>
                      <Btn ghost style={{ marginTop: "8px", fontSize: "10px", padding: "5px 12px" }}
                        onClick={() => setCorrectingDose(false)}>
                        Cancel
                      </Btn>
                    </div>
                  )}
                </>
              )}
              {last.notes ? <div style={{ fontSize: "11px", color: C.muted, marginTop: "6px" }}>"{last.notes}"</div> : null}
            </Card>
          )}

          <div style={{ fontSize: "10px", color: C.muted, padding: "4px 2px", lineHeight: 1.7 }}>
            CYA {config.cya}ppm · {SHADE[config.shade].label} · {config.conc}% product
            {config.heaterOn && config.heaterTemp ? ` · Heater ${config.heaterTemp}°F` : ""}
            {model.multiplier !== 1 ? ` · decay ×${model.multiplier.toFixed(2)}` : ""}
          </div>
        </div>
        <Nav />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOG
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === "log") {
    const minFC  = config ? minFCforCYA(config.cya) : 1;
    const maxFC  = config ? maxFCforCYA(config.cya) : 5;
    const fcVal  = parseFloat(log.fc);
    const pred   = prediction();
    const predFC = pred?.fc ?? null;
    const diff   = (predFC !== null && !isNaN(fcVal)) ? Math.round((fcVal - predFC) * 10) / 10 : null;
    const diffColor = diff === null ? C.muted : diff > 0.3 ? C.good : diff < -0.3 ? C.danger : C.warn;
    const diffLabel = diff === null ? null : diff > 0 ? `+${diff} above prediction` : diff < 0 ? `${diff} below prediction` : "matches prediction";

    return (
      <div style={S.app}>
        <FontLoader />
        <div style={S.header}>
          <div>
            <div style={S.title}>LOG FC</div>
            <div style={S.sub}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
          <Btn ghost style={{ padding: "6px 12px", fontSize: "10px" }} onClick={() => setScreen("dashboard")}>Cancel</Btn>
        </div>
        <div style={S.content}>

          {/* Prediction comparison — shown when there is a prior prediction */}
          {predFC !== null && (
            <Card style={{ borderColor: `${C.accent}33`, padding: "12px 16px" }}>
              <Cap>MODEL PREDICTED</Cap>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ ...S.bigNum, fontSize: "36px", color: C.accent }}>{predFC}</div>
                  <div style={{ fontSize: "9px", color: C.muted, marginTop: "2px" }}>predicted ppm</div>
                </div>
                {!isNaN(fcVal) && log.fc !== "" && (
                  <>
                    <div style={{ fontSize: "24px", color: C.muted }}>→</div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ ...S.bigNum, fontSize: "36px", color: diffColor }}>{fcVal}</div>
                      <div style={{ fontSize: "9px", color: C.muted, marginTop: "2px" }}>your reading</div>
                    </div>
                    <div style={{ flex: 1, textAlign: "right" }}>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: diffColor }}>
                        {diff > 0 ? "+" : ""}{diff}
                      </div>
                      <div style={{ fontSize: "9px", color: C.muted, marginTop: "2px" }}>
                        {diff > 0.5 ? "higher than expected" : diff < -0.5 ? "lower than expected" : "on track"}
                      </div>
                    </div>
                  </>
                )}
              </div>
              {pred.dosed && (
                <div style={{ fontSize: "10px", color: C.muted, marginTop: "8px" }}>
                  Based on {pred.dosedTo} ppm after last dose · sun-weighted decay
                </div>
              )}
            </Card>
          )}

          <Card>
            <Cap>FREE CHLORINE READING (PPM)</Cap>
            <input style={{ ...S.input, fontSize: "36px", padding: "14px", textAlign: "center" }}
              type="number" step="0.1" min="0" max="20" placeholder="0.0"
              value={log.fc} onChange={e => setLog(d => ({ ...d, fc: e.target.value }))} />
            {log.fc && !isNaN(fcVal) && (
              <>
                <div style={{ marginTop: "8px", fontSize: "11px", color: fcVal < minFC ? C.danger : fcVal < maxFC ? C.warn : C.good }}>
                  {fcVal < minFC ? `⚠ Below safe min (${minFC} ppm)` : fcVal < maxFC ? `↓ Below target top (${maxFC} ppm)` : `✓ At or above target`}
                </div>
                {diffLabel && (
                  <div style={{ marginTop: "4px", fontSize: "11px", color: diffColor }}>
                    {diffLabel}
                  </div>
                )}
              </>
            )}
          </Card>
          <Card>
            <Cap>BATHER LOAD</Cap>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {[{ v: 0, l: "None" }, { v: 1, l: "Light" }, { v: 3, l: "Moderate" }, { v: 6, l: "Heavy" }].map(({ v, l }) => (
                <Btn key={v} primary={log.bathers === v} ghost={log.bathers !== v} onClick={() => setLog(d => ({ ...d, bathers: v }))}>{l}</Btn>
              ))}
            </div>
          </Card>
          <Card>
            <Cap>NOTES (OPTIONAL)</Cap>
            <input style={S.input} type="text" placeholder="Rain, shock, pool party…"
              value={log.notes} onChange={e => setLog(d => ({ ...d, notes: e.target.value }))} />
          </Card>
          <Btn primary style={{ width: "100%", padding: "14px", fontSize: "14px", opacity: log.fc && !isNaN(fcVal) ? 1 : 0.35 }} onClick={saveLog}>
            Save Measurement ✓
          </Btn>
        </div>
        <Nav />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HISTORY
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === "history") {
    const sorted   = [...meas].sort((a, b) => new Date(b.date) - new Date(a.date));
    const minFC    = config ? minFCforCYA(config.cya) : 1;
    const maxFC    = config ? maxFCforCYA(config.cya) : 5;
    const chartData = [...meas].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-14);
    const fcVals   = chartData.map(m => m.fc);
    const maxV     = Math.max(...fcVals, maxFC, 5);

    return (
      <div style={S.app}>
        <FontLoader />
        <div style={S.header}>
          <div>
            <div style={S.title}>HISTORY</div>
            <div style={S.sub}>{meas.length} measurements · model ×{model.multiplier.toFixed(2)}</div>
          </div>
        </div>
        <div style={S.content}>
          {chartData.length > 1 && (
            <Card>
              <Cap>FC TREND (LAST {chartData.length} READINGS)</Cap>
              <svg width="100%" height="80" viewBox={`0 0 ${chartData.length * 40} 80`} preserveAspectRatio="none">
                <line x1="0" x2={chartData.length * 40} y1={80 - (maxFC / maxV) * 70} y2={80 - (maxFC / maxV) * 70} stroke={C.accent} strokeWidth="1" strokeDasharray="4,4" />
                <line x1="0" x2={chartData.length * 40} y1={80 - (minFC / maxV) * 70} y2={80 - (minFC / maxV) * 70} stroke={`${C.danger}66`} strokeWidth="1" strokeDasharray="2,4" />
                <polyline points={chartData.map((m, i) => `${i * 40 + 20},${80 - (m.fc / maxV) * 70}`).join(" ")} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" />
                {chartData.map((m, i) => {
                  const color = m.fc >= minFC ? C.good : C.danger;
                  return <circle key={m.id} cx={i * 40 + 20} cy={80 - (m.fc / maxV) * 70} r="4" fill={color} />;
                })}
              </svg>
              <div style={{ display: "flex", gap: "12px", marginTop: "6px", fontSize: "9px", color: C.muted }}>
                <span style={{ color: C.good }}>■ Safe</span>
                <span style={{ color: C.danger }}>■ Below min</span>
                <span style={{ color: C.accent }}>-- Max {maxFC}ppm</span>
                <span style={{ color: `${C.danger}99` }}>-- Min {minFC}ppm</span>
              </div>
            </Card>
          )}
          {meas.length >= 2 && (
            <Card style={{ borderColor: `${C.accent}33` }}>
              <Cap>POOL DECAY MODEL</Cap>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <div style={{ ...S.bigNum, fontSize: "28px", color: C.accent }}>×{model.multiplier.toFixed(2)}</div>
                <div style={{ fontSize: "11px", color: C.muted }}>vs baseline</div>
              </div>
              <div style={{ fontSize: "11px", color: C.muted, marginTop: "6px" }}>
                {model.multiplier > 1.2 ? "Your pool uses chlorine faster than average. Check for algae, high phosphates, or heavy debris." :
                 model.multiplier < 0.85 ? "Your pool retains chlorine well." :
                 "Chlorine consumption is within normal range."}
              </div>
              {model.updated && <div style={{ fontSize: "9px", color: C.muted, marginTop: "6px" }}>Last calibrated {new Date(model.updated).toLocaleDateString()}</div>}
            </Card>
          )}
          {sorted.length === 0 ? (
            <Card style={{ textAlign: "center", color: C.muted, fontSize: "12px" }}>No measurements yet.</Card>
          ) : sorted.map(m => {
            const color = m.fc >= minFC ? C.good : C.danger;
            return (
              <div key={m.id} style={{ ...S.card, display: "flex", gap: "14px", alignItems: "center", marginBottom: "8px" }}>
                <div style={{ textAlign: "center", minWidth: "48px" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color, lineHeight: 1 }}>{m.fc}</div>
                  <div style={{ fontSize: "9px", color: C.muted, marginTop: "2px" }}>ppm FC</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px" }}>{new Date(m.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                  <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>
                    {m.uvIndex != null ? `UV ${m.uvIndex}` : ""}
                    {m.tempF != null ? ` · ${m.tempF}°F` : ""}
                    {m.bathers > 0 ? ` · ${["","Light","","Moderate","","","Heavy"][m.bathers] || "Swimmers"}` : ""}
                  </div>
                  {m.predictedFC !== null && m.predictedFC !== undefined && (
                    <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>
                      predicted {m.predictedFC} ppm
                      <span style={{ color: m.fc > m.predictedFC + 0.3 ? C.good : m.fc < m.predictedFC - 0.3 ? C.danger : C.muted, marginLeft: "6px" }}>
                        ({m.fc > m.predictedFC ? "+" : ""}{Math.round((m.fc - m.predictedFC) * 10) / 10})
                      </span>
                    </div>
                  )}
                  {m.effectiveFC && (
                    <div style={{ fontSize: "10px", color: C.accent, marginTop: "2px" }}>
                      + added {m.ozAdded} oz → {m.effectiveFC} ppm after dose
                    </div>
                  )}
                  {m.notes ? <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px", fontStyle: "italic" }}>"{m.notes}"</div> : null}
                </div>
              </div>
            );
          })}
        </div>
        <Nav />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === "settings") {
    const [heaterOn,   setHeaterOn]   = useState(config?.heaterOn   ?? false);
    const [heaterTemp, setHeaterTemp] = useState(config?.heaterTemp ?? 88);

    const saveHeater = () => {
      const updated = { ...config, heaterOn, heaterTemp: parseInt(heaterTemp) };
      store.set("pool-config", updated);
      setConfig(updated);
    };
    const resetModel = () => {
      const m = { multiplier: 1.0 };
      setModel(m); store.set("decay-model", m);
    };
    const clearAll = () => {
      if (!window.confirm("Clear all data and start over?")) return;
      store.del("pool-config"); store.del("measurements"); store.del("decay-model");
      setConfig(null); setMeas([]); setModel({ multiplier: 1.0 });
      setStep(0); setWiz({ gallons: "", cya: "30", shade: "full", zip: "", lat: "", lon: "", city: "", locSet: false, targetFC: "", conc: "10" });
      setScreen("setup");
    };

    return (
      <div style={S.app}>
        <FontLoader />
        <div style={S.header}>
          <div><div style={S.title}>SETTINGS</div><div style={S.sub}>Pool configuration</div></div>
        </div>
        <div style={S.content}>
          {config && (
            <Card>
              <Cap>CURRENT POOL SETUP</Cap>
              {[
                ["Volume",       `${config.gallons.toLocaleString()} gallons`],
                ["CYA",          `${config.cya} ppm`],
                ["FC range",     `${minFCforCYA(config.cya)} – ${maxFCforCYA(config.cya)} ppm`],
                ["Sun exposure", SHADE[config.shade].label],
                ["Location",     `${config.city}`],
                ["Product",      `${config.conc}% liquid chlorine`],
                ["Measurements", `${meas.length} logged`],
                ["Decay model",  `×${model.multiplier.toFixed(3)}`],
                ["Heater",       config.heaterOn ? `On — ${config.heaterTemp}°F` : "Off"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: "12px" }}>
                  <span style={{ color: C.muted }}>{k}</span><span>{v}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Heater */}
          <Card style={{ borderColor: heaterOn ? `${C.warn}55` : C.border }}>
            <Cap>POOL HEATER</Cap>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: heaterOn ? "14px" : "4px" }}>
              <div>
                <div style={{ fontSize: "13px" }}>Heater {heaterOn ? "ON" : "OFF"}</div>
                <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>
                  {heaterOn ? "Decay calc uses your target water temp" : "Decay calc uses air temp only"}
                </div>
              </div>
              <div onClick={() => setHeaterOn(v => !v)}
                style={{ width: "44px", height: "24px", borderRadius: "12px", background: heaterOn ? C.warn : C.border, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: "3px", left: heaterOn ? "23px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: heaterOn ? C.bg : C.muted, transition: "left 0.2s" }} />
              </div>
            </div>
            {heaterOn && (
              <>
                <Cap>TARGET WATER TEMP (°F)</Cap>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                  {[82, 84, 86, 88, 90, 92].map(t => (
                    <Btn key={t} primary={heaterTemp == t} ghost={heaterTemp != t} onClick={() => setHeaterTemp(t)}>{t}°</Btn>
                  ))}
                </div>
                <input style={{ ...S.input, marginBottom: "10px" }} type="number" placeholder="Custom °F"
                  value={heaterTemp} onChange={e => setHeaterTemp(e.target.value)} />
              </>
            )}
            <Btn primary style={{ width: "100%", marginTop: "4px" }} onClick={saveHeater}>Save Heater ✓</Btn>
          </Card>

          <Btn ghost style={{ width: "100%", marginBottom: "10px" }} onClick={() => { setStep(0); setScreen("setup"); }}>Reconfigure Pool →</Btn>
          <Btn ghost style={{ width: "100%", marginBottom: "10px" }} onClick={resetModel}>Reset Decay Model</Btn>
          <Btn ghost style={{ width: "100%", color: C.danger, borderColor: `${C.danger}55` }} onClick={clearAll}>Clear All Data</Btn>
          <div style={{ marginTop: "16px", fontSize: "10px", color: C.muted, lineHeight: 1.8 }}>
            Data is stored in your browser's local storage. CYA should be tested every 4–6 weeks.
          </div>
        </div>
        <Nav />
      </div>
    );
  }

  return null;
}
