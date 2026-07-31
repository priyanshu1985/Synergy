# Raahat — Firebase Version Setup Guide

This version of **Raahat** uses **Firebase Cloud Firestore** and **Firebase Cloud Functions** instead of Supabase.

---

## 1. Set Up Firebase Project (5 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and click **Add Project**. Name it `raahat-flood-sos` (or any name).
2. Go to **Build → Firestore Database** → click **Create database**.
   - Choose a location close to you.
   - Start in **Test mode** (or Production mode, then load `firebase/firestore.rules`).
3. Go to **Project Settings** (gear icon) → **General** → Scroll down to **Your apps**.
4. Click the **Web (</>)** icon to register a web app.
5. Copy your Firebase Configuration values:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

---

## 2. Configure Environment Files

Paste your Firebase keys into `.env.local` for both frontends:

### In `citizen-app/.env.local`:
```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

### In `dashboard/.env.local`:
```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

---

## 3. Run the Citizen App

```bash
cd citizen-app
npm run dev
```

---

## 4. Run the Responder Dashboard

```bash
cd dashboard
npm run dev
```

---

## 5. (Optional) AI Auto-Triage Firebase Function

The Cloud Function automatically triggers when a new SOS arrives in Firestore and categorizes urgency with Claude AI.

To deploy it:
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Log in: `firebase login`
3. Set your Claude API key:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
4. Deploy rules and functions:
   ```bash
   cd firebase
   firebase deploy
   ```
