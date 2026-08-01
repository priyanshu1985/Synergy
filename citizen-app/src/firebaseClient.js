import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let app;
let db = null;

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.warn(
    'Missing Firebase env vars. App will run in offline demo mode using IndexedDB local queue.'
  );
} else {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (err) {
    console.error('Failed to initialize Firebase client:', err);
  }
}

export { db };

