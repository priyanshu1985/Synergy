import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { db } from './firebaseClient';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import './styles.css';

const SITUATION_LABEL = {
  stranded: 'Stranded / water rising',
  injured: 'Injured person',
  supplies: 'Needs food / water',
  evacuate: 'Needs evacuation'
};
const CRITICAL = new Set(['stranded', 'injured']);

const FLAG_LABEL = {
  medical_emergency: 'Medical emergency',
  elderly: 'Elderly',
  children: 'Children',
  pregnant: 'Pregnant',
  disabled: 'Disabled',
  no_supplies: 'No supplies',
  structural_danger: 'Structural danger'
};

// AI verdict wins when it's in — it's reading the free-text notes, which can reveal
// something the dropdown category alone misses (e.g. "supplies" selected, but the
// note says someone is having a medical emergency).
function isCritical(r) {
  if (r.ai_priority) return r.ai_priority === 'critical' || r.ai_priority === 'high';
  return CRITICAL.has(r.situation);
}

function markerColor(r) {
  if (r.status === 'rescued') return '#2BAF66';
  if (isCritical(r)) return '#FF5A1F';
  if (r.situation === 'evacuate') return '#F2A93B';
  return '#8FA1BA';
}

export default function App() {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Realtime — Firestore pushes new/changed documents straight to this dashboard.
    // No polling loop, no delay: a citizen's SOS shows up here within a second or two.
    const q = query(collection(db, 'requests'), orderBy('captured_at', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data()
        }));
        setRequests(list);
        setLoaded(true);
      },
      (error) => {
        console.error('Firestore realtime error:', error);
        setLoaded(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const updateStatus = async (id, status) => {
    // optimistic update so the click feels instant even before Firestore echoes back
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await updateDoc(doc(db, 'requests', id), { status });
    } catch (err) {
      console.error('Error updating status in Firestore:', err);
    }
  };


  const withLoc = requests.filter((r) => r.lat && r.lng);
  const critical = requests.filter((r) => isCritical(r) && r.status !== 'rescued').length;
  const pending = requests.filter((r) => r.status === 'pending').length;
  const rescued = requests.filter((r) => r.status === 'rescued').length;

  const filtered = requests.filter((r) => filter === 'all' || r.status === filter);
  const sorted = [...filtered].sort((a, b) => {
    const aCrit = isCritical(a) ? 0 : 1;
    const bCrit = isCritical(b) ? 0 : 1;
    if (aCrit !== bCrit) return aCrit - bCrit;
    return b.captured_at - a.captured_at;
  });

  const center = withLoc.length
    ? [withLoc[0].lat, withLoc[0].lng]
    : [20.5937, 78.9629]; // India-wide fallback view

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <div className="title">Raahat — Response Dashboard</div>
          <div className="sub">Live requests from citizens on the ground</div>
        </header>

        <div className="stats">
          <div className="stat danger"><div className="num">{critical}</div><div className="label">Critical</div></div>
          <div className="stat amber"><div className="num">{pending}</div><div className="label">Pending</div></div>
          <div className="stat safe"><div className="num">{rescued}</div><div className="label">Rescued</div></div>
        </div>

        <div className="filters">
          {['all', 'pending', 'dispatched', 'rescued'].map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="request-list">
          {!loaded && <div className="empty-state">Loading…</div>}
          {loaded && sorted.length === 0 && (
            <div className="empty-state">
              {requests.length === 0 ? 'Waiting for the first request…' : 'No requests in this view.'}
            </div>
          )}
          {sorted.map((r) => (
            <div key={r.id} className={`request-card sit-${r.situation} status-${r.status}`}>
              <div className="row1">
                <span className="name">{r.name} · {r.people_count} people</span>
                <span className="time">{new Date(r.captured_at).toLocaleTimeString()}</span>
              </div>
              <div className="situation-tag">{SITUATION_LABEL[r.situation] || r.situation}</div>

              {r.ai_priority && (
                <div className={`ai-badge ai-${r.ai_priority}`}>
                  AI: {r.ai_priority.toUpperCase()}
                  {r.ai_summary ? ` — ${r.ai_summary}` : ''}
                </div>
              )}
              {!r.ai_priority && (
                <div className="ai-badge ai-pending">AI: analyzing notes…</div>
              )}
              {r.ai_flags && r.ai_flags.length > 0 && (
                <div className="ai-flags">
                  {r.ai_flags.map((f) => (
                    <span key={f} className="ai-flag-tag">{FLAG_LABEL[f] || f}</span>
                  ))}
                </div>
              )}

              {r.notes && <div className="notes">{r.notes}</div>}
              <div className="meta">
                📍 {r.lat ? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` : 'No GPS captured'} · 📞 {r.phone}
              </div>
              <div className="actions">
                <button className="primary" onClick={() => updateStatus(r.id, 'dispatched')}>Mark dispatched</button>
                <button className="done" onClick={() => updateStatus(r.id, 'rescued')}>Mark rescued</button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="map-wrap">
        <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {withLoc.map((r) => (
            <CircleMarker
              key={r.id}
              center={[r.lat, r.lng]}
              radius={9}
              pathOptions={{ color: '#0F1B2B', weight: 2, fillColor: markerColor(r), fillOpacity: 0.9 }}
            >
              <Popup>
                <b>{r.name}</b><br />
                {SITUATION_LABEL[r.situation] || r.situation}<br />
                {r.people_count} people<br />
                {r.phone}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
