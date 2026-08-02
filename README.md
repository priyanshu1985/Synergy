# Raahat — Enterprise Disaster Command Center & SOS Ecosystem

**Raahat** is an enterprise-grade, multi-app disaster management ecosystem connecting citizens in distress, government command centers, and field rescue responder units during extreme weather and flood events.

---

## 🌐 Live Deployed Applications (Firebase Multi-Site Hosting)

| Application | Description | Live Deployment URL | Firebase Site ID |
| :--- | :--- | :--- | :--- |
| 🏡 **Landing Portal** | Central entry portal for platform navigation | [raahat-home.web.app](https://raahat-home.web.app) | `raahat-home` |
| 🚨 **Citizen SOS PWA** | Progressive Web App for citizens in distress | [raahat-citizen.web.app](https://raahat-citizen.web.app) | `raahat-citizen` |
| 🏛️ **Command Dashboard** | Government Disaster Command Center | [raahat-dashboard.web.app](https://raahat-dashboard.web.app) | `raahat-dashboard` |
---

## 🔑 Login Credentials

| Application Portal | Email Address | Password |
| :--- | :--- | :--- |
| 🏛️ **Command Dashboard** | `bala@gamil.com` | `Balakirshna` |
| 🚒 **Rescue Team Dashboard** | `bala@gamil.com` | `Balakirshna` |

---

## 🏗️ Architecture & Component System

The platform is structured into 4 decoupled applications built on top of a unified enterprise design language inspired by Ant Design Pro, Vercel, and Grafana:

### 1. Unified `AppLayout` Shell Architecture
- **Fixed Left Sidebar**: `90px` width (`72px` collapsed), fixed position, zero movement on content scroll.
- **Sticky Top Header**: `64px` height sticky header bar with brand title, live status badge, and user authentication actions.
- **Scrollable Content Container**: `width: 100%`, `height: calc(100vh - 64px)`, `padding: 24px`, `overflow-y: auto`, `overflow-x: hidden`. Every sub-page scrolls independently inside `<main className="layout-content-area">`.
- **Zero Horizontal Overflow**: Fluid CSS Grid system supporting screen resolutions from 480px mobile to 1920px 4K displays.

### 2. 12-Column CSS Grid System
- **Master Grid**: `display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 24px;`
- **Dashboard Home**:
  - **KPI Stats Row**: `grid-column: span 12` with auto-fit `repeat(auto-fit, minmax(210px, 1fr))` stat cards.
  - **High-Res Satellite Map**: `grid-column: span 8` (`height: 520px`, `border-radius: 16px`) with Google Maps Satellite hybrid tile layer, emergency pulse markers, and floating map legend.
  - **Emergency SOS Queue Panel**: `grid-column: span 4` (`height: 520px`, `border-radius: 16px`) with search filter, status pills, and scrollable prioritized incident cards.
  - **Bottom Analytics Row**: 3 equal cards `grid-column: span 4` each (Live Activity Timeline, Resource Overview, Recent Disaster Alerts).

### 3. Dedicated Sub-Page Directory Views
- **Incidents Operations Center (`/incidents`)**: Full-page incident queue with search, status filters, and priority sorting.
- **Infrastructure Directory (`/infrastructure`)**: Monitored Hospitals, Relief Shelters, Police Posts, Fire Stations, and Weather Radar Units arranged in a responsive auto-fit grid (`repeat(auto-fit, minmax(360px, 1fr))`) with facility registration modals.
- **Predictive Flood Telemetry (`/risk_prediction`)**: Real-time Open-Meteo precipitation & river discharge telemetry with Gemini AI public flood warnings.
- **Rescue Resource Allocation (`/resources`)**: Allocation status for NDRF squads, rescue boats, ambulances, and volunteers.

---

## ⚡ Key Features

### 🚨 Prioritized Emergency SOS Queue
- **AI Priority Ranking**: Critical & Escalated distress calls (`injured`, `stranded`, structural danger) automatically float to the **very top of the queue**.
- **Newest Timestamp Sorting**: Secondary sorting arranges requests chronologically by submission time.
- **Rich Incident Cards**: Displays victim name, headcount, category badge, AI summary, GPS coordinates `📍`, contact phone `📞`, hazard chips (`🔴 STRUCTURAL DANGER`), and media attachment badges (`📷 PHOTO ATTACHED`, `🎙️ VOICE SOS`).

### 🌊 Predictive Flood Early-Warning Telemetry
- **Open-Meteo Forecast Telemetry**: Fetches 48h peak precipitation (mm) and 72h river discharge ($m^3/s$) for disaster sectors.
- **Automated Risk Engine**: 3-hour background job evaluates deterministic flood risk levels (`SEVERE`, `ELEVATED`, `NORMAL`).
- **Gemini AI Plain-Language Warnings**: Calls Gemini API to turn raw meteorological telemetry into actionable public warning advisories.

### 🧠 Deterministic Resource Recommendation Engine
- **Hospital Matching**: Evaluates operational status and bed availability:
  $$\text{Score} = \left(\frac{\text{AvailableBeds}}{\text{TotalBeds}}\right) \times 0.4 + \left(\frac{1}{\text{Distance} + 0.01}\right) \times 0.6$$
- **Shelter Matching**: Evaluates shelter capacity:
  $$\text{Score} = \left(\frac{\text{AvailableCapacity}}{\text{TotalCapacity}}\right) \times 0.4 + \left(\frac{1}{\text{Distance} + 0.01}\right) \times 0.6$$

---

## 🛠️ Local Development & Build Commands

### 1. Clone & Install Dependencies

```bash
# Install Citizen App
cd citizen-app && npm install

# Install Responder Dashboard
cd ../dashboard && npm install

# Install Rescue Team Dashboard
cd ../rescue-dashboard && npm install
```

### 2. Run Applications Locally

```bash
# Run Citizen SOS App (Port 5173)
cd citizen-app && npm run dev

# Run Command Center Dashboard (Port 5174)
cd dashboard && npm run dev

# Run Rescue Team Dashboard (Port 5175)
cd rescue-dashboard && npm run dev
```

### 3. Build for Production

```bash
# Build Citizen App
cd citizen-app && npm run build

# Build Command Dashboard
cd ../dashboard && npm run build

# Build Rescue Dashboard
cd ../rescue-dashboard && npm run build
```

---

## 🚀 Deployment (Firebase Multi-Site Hosting)

To deploy specific sites or all sites together using Firebase CLI:

```bash
# Deploy Landing Portal only
firebase deploy --only hosting:raahat-home

# Deploy Citizen SOS PWA only
firebase deploy --only hosting:raahat-citizen

# Deploy Command Dashboard only
firebase deploy --only hosting:raahat-dashboard

# Deploy Rescue Team Dashboard only
firebase deploy --only hosting:raahat-rescue

# Deploy ALL sites & Cloud Functions simultaneously
firebase deploy
```

---

## 📂 Project Structure

```
flood-sos-react/
├── landing/                   # Minimal static landing portal (raahat-home.web.app)
│   ├── index.html
│   └── styles.css
├── citizen-app/               # Citizen Distress PWA (raahat-citizen.web.app)
│   ├── src/App.jsx
│   ├── src/db.js              # Offline-first IndexedDB storage
│   └── src/styles.css
├── dashboard/                 # Command Center Dashboard (raahat-dashboard.web.app)
│   ├── src/App.jsx
│   ├── src/components/
│   │   ├── layout/AppLayout.jsx
│   │   ├── ui/ (StatCard, IncidentCard, FacilityCard)
│   │   └── pages/ (DashboardHome, InfrastructurePage, RiskPredictionPage, IncidentsPage)
│   └── src/styles.css         # Master CSS Grid & Design Tokens
├── rescue-dashboard/          # Field Responder Portal (raahat-rescue.web.app)
│   ├── src/App.jsx
│   └── src/styles.css
├── firebase/                  # Firebase Backend Infrastructure
│   ├── firestore.rules
│   └── functions/index.js     # AI Triage & Flood Early-Warning Functions
├── firebase.json              # Multi-site hosting configuration
└── .firebaserc                # Firebase project mapping
```

---

## 🔒 Security Model

- **Anonymous Citizen SOS Broadcaster**: Anyone can submit emergency SOS requests (`allow create: if true;`).
- **Authenticated Command Center & Field Teams**: Only authenticated responders can read distress details, update incident status (`dispatched`, `rescued`), or modify resource availability (`allow read, write: if request.auth != null;`).
