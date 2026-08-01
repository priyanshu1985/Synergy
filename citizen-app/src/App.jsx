import { useEffect, useRef, useState } from 'react';
import { db } from './firebaseClient';
import { doc, setDoc } from 'firebase/firestore';
import { saveLocal, getAllLocal } from './db';
import './styles.css';

const SITUATIONS = [
  { value: 'stranded', label: 'Stranded / water rising' },
  { value: 'injured', label: 'Injured person' },
  { value: 'supplies', label: 'Need food / water' },
  { value: 'evacuate', label: 'Need evacuation' }
];

// Tries to insert straight to Firestore. `setDoc` with localId as document ID means a
// retried request (already delivered once) doesn't create a duplicate document.
async function trySend(record) {
  if (!db) {
    console.warn('Database is not initialized. Keeping request in local offline queue.');
    return false;
  }
  try {
    await setDoc(doc(db, 'requests', record.localId), {
      id: record.localId,
      local_id: record.localId,
      name: record.name,
      phone: record.phone,
      people_count: record.peopleCount,
      situation: record.situation,
      notes: record.notes,
      lat: record.lat,
      lng: record.lng,
      accuracy: record.accuracy,
      captured_at: record.capturedAt,
      received_at: new Date().toISOString(),
      status: 'pending'
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('Firestore write error:', err);
    return false;
  }
}


export default function App() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [people, setPeople] = useState('');
  const [notes, setNotes] = useState('');
  const [situation, setSituation] = useState(null);
  const [gpsText, setGpsText] = useState('Getting your location…');
  const [gpsLocked, setGpsLocked] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState([]);
  const [btnState, setBtnState] = useState('idle'); // idle | sending | saved
  const coordsRef = useRef(null);

  const refreshQueue = async () => setQueue(await getAllLocal());

  const flushQueue = async () => {
    const all = await getAllLocal();
    const queued = all.filter((r) => r.status === 'queued');
    for (const record of queued) {
      const ok = await trySend(record);
      if (ok) {
        record.status = 'sent';
        await saveLocal(record);
      }
    }
    refreshQueue();
  };

  useEffect(() => {
    // GPS — start watching immediately so coordinates are ready before SOS is pressed
    if ('geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          coordsRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          setGpsText(`Location locked (±${Math.round(pos.coords.accuracy)}m)`);
          setGpsLocked(true);
        },
        () => setGpsText('Could not get location — check permission. Request will still send.'),
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      setGpsText('Location not supported on this device — request will still send.');
    }
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      flushQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    refreshQueue();
    flushQueue(); // catch anything queued from a previous visit
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    // Periodically retry sending queued items (every 15s) in case of poor signal
    // where the browser reports 'online' but requests initially timed out.
    const interval = setInterval(() => {
      const hasQueued = queue.some((r) => r.status === 'queued');
      if (hasQueued) {
        console.log('Background retry: attempting to flush queued requests...');
        flushQueue();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [queue]);

  const handleSubmit = async () => {
    if (!situation) {
      alert("Please choose what the situation is.");
      return;
    }
    setBtnState('sending');

    const coords = coordsRef.current;
    const record = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || 'Not given',
      phone: phone.trim() || 'Not given',
      peopleCount: people.trim() || '1',
      situation,
      notes: notes.trim(),
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
      accuracy: coords ? coords.accuracy : null,
      capturedAt: Date.now(),
      status: 'queued'
    };

    await saveLocal(record);
    const sentNow = await trySend(record);
    if (sentNow) {
      record.status = 'sent';
      await saveLocal(record);
    } else {
      // Trigger a retry soon in case of flaky network
      setTimeout(flushQueue, 5000);
    }

    setBtnState('saved');
    setTimeout(() => setBtnState('idle'), 3500);
    refreshQueue();
  };

  const btnLabel =
    btnState === 'sending' ? 'SENDING…' : btnState === 'saved' ? 'SAVED ✓' : 'SEND SOS';

  return (
    <div>
      <header className="top">
        <div className="brand">
          Raahat <span>SOS</span>
        </div>
        <div id="net-status" className={!db ? 'demo' : online ? 'online' : 'offline'}>
          {!db ? 'DEMO MODE' : online ? 'ONLINE' : 'NO SIGNAL'}
        </div>
      </header>

      <main>
        {queue.some((r) => r.status === 'queued') && (
          <div className="pending-banner show">
            You have {queue.filter((r) => r.status === 'queued').length} request(s) saved on this
            phone, waiting to send. They will go out the moment you get any signal.
          </div>
        )}

        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Patil" />
        </div>

        <div className="field">
          <label htmlFor="phone">Phone number</label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" />
        </div>

        <div className="field">
          <label htmlFor="people">Number of people with you</label>
          <input id="people" type="text" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="e.g. 4" />
        </div>

        <div className="field">
          <label>What's the situation?</label>
          <div className="situation-grid">
            {SITUATIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={situation === s.value ? 'selected' : ''}
                onClick={() => setSituation(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Anything else rescuers should know (optional)</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Landmark, floor number, elderly/children, etc." />
        </div>

        <div id="gps-line" className={gpsLocked ? 'locked' : ''}>
          <span className="dot"></span>
          <span>{gpsText}</span>
        </div>

        <div className="sos-wrap">
          <button
            id="sos-btn"
            className={btnState === 'saved' ? 'saved' : ''}
            disabled={btnState === 'sending'}
            onClick={handleSubmit}
          >
            {btnLabel}
          </button>
          <div className="sos-caption">
            Your exact location is sent with this request. Press once — you'll see it change to
            "Saved" whether or not you have signal.
          </div>
        </div>

        <div className="queue-list">
          <h2>Your requests on this phone</h2>
          <div>
            {[...queue]
              .sort((a, b) => b.capturedAt - a.capturedAt)
              .map((r) => (
                <div className="queue-item" key={r.localId}>
                  <span>
                    {r.situation} · {new Date(r.capturedAt).toLocaleTimeString()}
                  </span>
                  <span className={`status ${r.status}`}>
                    {r.status === 'sent' ? 'SENT' : 'WAITING FOR SIGNAL'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </main>
    </div>
  );
}
