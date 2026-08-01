# Raahat — Disaster Command Center & SOS Platform

Raahat is an offline-first, real-time disaster command center and SOS routing system designed to connect citizens in flood zones with rescue teams and emergency resources on the ground.

## 🚨 Phase 6 - Live Situation Overview
The responder dashboard now includes a live command-center overview that summarizes the current disaster posture at a glance. It surfaces deterministic metrics from the active Firestore/demo data, including overall risk, active and critical SOS counts, estimated affected people, active emergency clusters, medical emergencies, hospital capacity, shelter capacity, and available rescue resources. An AI-generated summary is also shown alongside the metrics so responders can quickly assess the situation without leaving the dashboard.

### How to test it
1. Start the dashboard with `cd dashboard && npm run dev`.
2. Sign in as the demo responder (or use your configured Firebase responder account) and wait for the dashboard to load.
3. Confirm the new Live Situation Overview card appears in the command-center sidebar and updates as SOS requests, hospitals, shelters, and resources change.
4. Open the report modal to verify the RAAHAT SITREP generation flow still works.

---

## 🏗️ Architecture Overview

The system consists of the following components:
1. **Citizen App (`citizen-app/`)**: React + Vite Progressive Web App (PWA) with a form to capture name, phone number, headcount, situation, notes, and GPS coordinates.
2. **Offline-first Queue (IndexedDB)**: If a citizen has no cellular network or internet access, distress calls are stored locally in IndexedDB and automatically synchronized with Firestore once signal returns.
3. **Firestore Database (`firebase/firestore.rules`)**: A cloud-based real-time database storing SOS requests and command center data.
4. **AI Auto-Triage (`firebase/functions/`)**: A Firebase Cloud Function triggered on new SOS submissions. It calls the Anthropic API (Claude 3.5 Haiku) to read citizen notes and classify the incident's priority (`critical` / `high` / `normal`), generate flags, and summarize the notes.
5. **RAAHAT Command Decision Engine**:
   - **AI Situation Summary**: Analyzes aggregate metrics (Active/Critical SOS, beds, shelters, resources) to compile overall severity ratings, focus areas, and recommended command actions.
   - **Deterministic Recommendation matching**: Selects eligible Hospitals (operational, beds > 0), Shelters (occupancy < capacity), and Resources (available, matching resource type based on incident situation) using weighted mathematical models, then queries Claude to explain the match.
   - **SITREP Situation Report**: Generates structured, print-ready disaster logs and administrative summaries in Markdown.
6. **Responder Command Center Dashboard (`dashboard/`)**: A React + Vite dashboard displaying:
   - **Floating Summary Cards**: Floating overlay stats tracking Active SOS, Critical SOS, Available Resources, Bed Availability, Shelter capacity, and dynamic disaster severity rating.
   - **Master-Detail SOS Coordinator Panel**: Click on an SOS request to inspect headcount, situation, notes, and the **RAAHAT AI Recommendation Panel** (with score progress bars, resource matching, and AI explainers).
   - **Sidebar Tabs**: Toggles between the **SOS Request Queue** and **Infrastructure Directory**.
   - **Emergency Cluster Detection**: Uses deterministic geospatial distance calculations to group nearby SOS requests into possible larger incidents, showing cluster location, number of SOS, critical count, estimated people affected, and priority on both the sidebar and the map.
   - **Interactive Map**: Plotting CircleMarkers for SOS requests, hospitals, shelters, resource types, and emergency clusters using Leaflet and OpenStreetMap.
7. **Authentication & Authorization**: Firebase Authentication secures the Command Center. Public citizens can submit alerts anonymously, but only authenticated responders can read lists/details, coordinate dispatch, or modify emergency resources.

---

## 🧠 AI Recommendation & Scoring Models

To ensure safety and reliability, recommendations rely on **deterministic selection first, AI explanation second**. The LLM never invents capacity or performs automated dispatch:

### 1. Hospital Matching
- **Eligibility**: `status` !== 'Closed' and `availableBeds` > 0.
- **Formula**:
  $$Score = \left(\frac{AvailableBeds}{TotalBeds}\right) \times 0.4 + \left(\frac{1}{Distance + 0.01}\right) \times 0.6$$

### 2. Shelter Matching
- **Eligibility**: `available` capacity > 0.
- **Formula**:
  $$Score = \left(\frac{AvailableCapacity}{TotalCapacity}\right) \times 0.4 + \left(\frac{1}{Distance + 0.01}\right) \times 0.6$$

### 3. Resource Matching (Transparent Weighted Scoring)
- **Eligibility**: `availability` === 'available'.
- **Situation Matching Weight**:
  - Stranded/Evacuate -> Boat (1.0), Rescue Team (0.8), Fire Truck (0.6)
  - Injured -> Ambulance (1.0), Rescue Team (0.7), Volunteer (0.5)
  - Supplies -> Volunteer (1.0), Fire Truck (0.6)
- **Formula**:
  $$Score = (TypeWeight \times 0.6) + \left(\frac{1}{Distance + 0.01} \times 0.4\right)$$

---

## 🔒 Security Model & Firestore Rules

To protect citizens' data while keeping emergency reporting accessible, Raahat implements a zero-trust model for anonymous clients:
- **Citizen SOS Creation**: Anyone (anonymous) can create a new request:
  `allow create: if true;`
- **Responder Reads & Updates**: Only authenticated users can read lists/details or mark individuals dispatched/rescued:
  `allow read, update: if request.auth != null;`
- **Command Center Directory**: Security rules restrict access to responder-only information (`hospitals`, `shelters`, `resources`):
  `allow read, write: if request.auth != null;`

---

## 🛠️ Installation & Setup

### 1. Set Up Firebase Project (5 minutes)

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Firestore Database** in **Test Mode** (rules will be uploaded via CLI).
3. Enable **Firebase Authentication** and turn on **Email/Password** provider under Sign-in methods.
4. Add a **Web App** under Project Settings and copy your Firebase configuration keys.

### 2. Configure Environment Files

Create `.env.local` files for both frontends with your Firebase keys:

#### In `citizen-app/.env.local` & `dashboard/.env.local`:
```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

### 3. Deploy Firestore Rules & Cloud Functions

1. Install the Firebase CLI: `npm install -g firebase-tools`
2. Log in and configure your project: `firebase login`
3. Configure the Anthropic Claude API key for the Cloud Function:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY=your_claude_api_key_here
   ```
4. Deploy rules and functions from the `firebase/` directory:
   ```bash
   cd firebase
   firebase deploy
   ```

### 4. Run the Citizen App Locally

```bash
cd citizen-app
npm install
npm run dev
```

### 5. Run the Responder Dashboard Locally

```bash
cd dashboard
npm install
npm run dev
```
*(Note: If Firebase config environment variables are not found, the dashboard defaults to **Offline Demo Mode** with mock data and auto-authenticated demo credentials. In real Firebase mode, if the database collections `hospitals`, `shelters`, or `resources` are detected to be empty upon logging in, the app will automatically seed them with simulation datasets in the background. If Cloud Functions are not deployed, the dashboard intercepts the network exception and executes the client-side fallback decision engine seamlessly).*

---

## 📂 Project Structure

- [citizen-app/](file:///C:/Synergy/citizen-app) — Citizen PWA code
  - [src/App.jsx](file:///C:/Synergy/citizen-app/src/App.jsx) — Form, offline queue UI, and Firestore submission
  - [src/db.js](file:///C:/Synergy/citizen-app/src/db.js) — Local IndexedDB helper functions
  - [src/firebaseClient.js](file:///C:/Synergy/citizen-app/src/firebaseClient.js) — Firebase initialization
- [dashboard/](file:///C:/Synergy/dashboard) — Responder command center code
  - [src/App.jsx](file:///C:/Synergy/dashboard/src/App.jsx) — Master-Detail SOS coordinator, AI recommendations explainer, weighted scoring, tab panels, and overlay stats.
  - [src/firebaseClient.js](file:///C:/Synergy/dashboard/src/firebaseClient.js) — Firebase configuration & Auth export
- [firebase/](file:///C:/Synergy/firebase) — Firebase setup
  - [firestore.rules](file:///C:/Synergy/firebase/firestore.rules) — Access rules for requests, hospitals, shelters, and resources
  - [functions/index.js](file:///C:/Synergy/firebase/functions/index.js) — Claude AI Triage, Decision Summary, Recommendations Explainer, and SITREP Report Generator
