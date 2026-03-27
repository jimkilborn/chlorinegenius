# Chlor.io — Pool Chlorine Tracker PWA

Smart pool chlorine dosing with adaptive decay learning, live weather, and TFP range targeting.

## Deploy to Vercel (free, ~10 minutes)

### 1. Install Node.js
Download from https://nodejs.org — install the LTS version.

### 2. Create a GitHub account
Go to https://github.com and sign up if you don't have one.

### 3. Push this project to GitHub
```bash
# In this folder:
git init
git add .
git commit -m "Initial chlor.io"
# Create a new repo at github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/chlorio.git
git push -u origin main
```

### 4. Deploy on Vercel
1. Go to https://vercel.com and sign in with GitHub
2. Click "Add New Project"
3. Import your `chlorio` repo
4. Leave all settings as default — Vercel auto-detects Vite
5. Click Deploy

Your app will be live at `https://chlorio-xxx.vercel.app` in about 60 seconds.

### 5. Install on Android as a PWA
1. Open the Vercel URL in **Chrome** on your Android phone
2. Tap the 3-dot menu → "Add to Home Screen"
3. It installs like a native app with its own icon

---

## What works in PWA vs Claude artifact

| Feature | Claude artifact | PWA |
|---|---|---|
| ZIP code lookup | ❌ blocked | ✅ |
| GPS location | ❌ blocked | ✅ |
| Live weather | ❌ blocked | ✅ |
| Data persistence | ✅ | ✅ localStorage |
| Works offline | partial | ✅ service worker |
| Home screen install | ❌ | ✅ |

---

## Local development

```bash
npm install
npm run dev
# Opens at http://localhost:5173
```

## Build for production

```bash
npm run build
# Output in /dist folder
```

---

## APIs used (all free, no keys required)

- **Zippopotam.us** — ZIP code to lat/lon
- **Open-Meteo** — UV index, temperature, cloud cover
- **Browser Geolocation API** — GPS location

## Chemistry

Dosing formula: `10.65 oz of 10% NaOCl raises 10,000 gallons by 1 ppm FC`

TFP FC ranges by CYA:
- CYA 30: 2–5 ppm
- CYA 40: 3–7 ppm  
- CYA 50: 3–7 ppm
- CYA 70: 4–9 ppm

Decay model learns from your actual measurements and self-calibrates over time.
