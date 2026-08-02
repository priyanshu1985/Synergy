import { useEffect, useState } from 'react';
import { db, auth } from './firebaseClient';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import './styles.css';

const SITUATION_LABEL = {
  stranded: 'Stranded / water rising',
  injured: 'Injured person',
  supplies: 'Needs food / water',
  evacuate: 'Needs evacuation'
};

// Mock demo assigned requests for offline testing
const DEMO_ASSIGNED_INCIDENTS = [
  {
    id: 'demo-assigned-1',
    name: 'Asha Rao',
    phone: '9876543210',
    people_count: 4,
    situation: 'stranded',
    notes: 'Kurla East near Metro station · 🎙️ Voice SOS Attached',
    lat: 20.5933,
    lng: 78.9628,
    captured_at: Date.now() - 300000,
    status: 'team_assigned',
    assigned_resource_id: 'res-alpha-1',
    assigned_resource_name: 'Rescue Boat Alpha',
    assigned_at: new Date(Date.now() - 300000).toISOString(),
    ai_priority: 'critical'
  },
  {
    id: 'demo-assigned-2',
    name: 'Vikram Patel',
    phone: '9123456789',
    people_count: 2,
    situation: 'injured',
    notes: 'Severe leg injury on 3rd floor',
    lat: 20.6020,
    lng: 78.9750,
    captured_at: Date.now() - 600000,
    status: 'team_assigned',
    assigned_resource_id: 'res-alpha-1',
    assigned_resource_name: 'Rescue Boat Alpha',
    assigned_at: new Date(Date.now() - 600000).toISOString(),
    ai_priority: 'critical'
  }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [requests, setRequests] = useState([]);
  const [isDemo, setIsDemo] = useState(false);

  // Listen to Auth state
  useEffect(() => {
    if (!auth) {
      // No Firebase configured — run in demo mode
      setUser({ email: 'team-alpha@raahat.org', isDemo: true });
      setIsDemo(true);
      setRequests(DEMO_ASSIGNED_INCIDENTS);
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setRequests([]);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen to Firestore assigned requests (all requests with team_assigned or dispatched status)
  useEffect(() => {
    if (!db || !user || isDemo) return;

    const unsub = onSnapshot(
      collection(db, 'requests'),
      (snap) => {
        const list = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          // Show all requests that have been assigned to a rescue team or dispatched
          // (excludes pending, rescued, and safe_report markers)
          if (
            (data.status === 'team_assigned' || data.status === 'dispatched') &&
            data.type !== 'safe_report'
          ) {
            list.push({ id: docSnap.id, ...data });
          }
        });
        // Sort by priority: critical first, then high, then normal; then by time
        list.sort((a, b) => {
          const priorityOrder = { critical: 0, high: 1, normal: 2 };
          const aPri = priorityOrder[a.ai_priority] ?? 2;
          const bPri = priorityOrder[b.ai_priority] ?? 2;
          if (aPri !== bPri) return aPri - bPri;
          return (b.captured_at || 0) - (a.captured_at || 0);
        });
        setRequests(list);
      },
      (err) => console.error('Firestore rescue requests listener error:', err)
    );

    return () => unsub();
  }, [user, isDemo]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (!auth) {
        setUser({ email, isDemo: true });
        setIsDemo(true);
        setRequests(DEMO_ASSIGNED_INCIDENTS);
        return;
      }
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setAuthError('Login failed: ' + err.message);
    }
  };

  const handleSignOut = () => {
    if (auth) signOut(auth);
    setUser(null);
  };

  const handleMarkDispatched = async (reqId) => {
    const nowStr = new Date().toISOString();
    try {
      if (db) {
        await updateDoc(doc(db, 'requests', reqId), {
          status: 'dispatched',
          dispatched_at: nowStr
        });
      } else {
        setRequests(prev =>
          prev.map(r => r.id === reqId ? { ...r, status: 'dispatched', dispatched_at: nowStr } : r)
        );
      }
    } catch (err) {
      console.error('Error marking dispatched:', err);
      alert('Failed to update status: ' + err.message);
    }
  };

  const handleMarkRescued = async (reqId, resId) => {
    const nowStr = new Date().toISOString();
    try {
      if (db) {
        await updateDoc(doc(db, 'requests', reqId), {
          status: 'rescued',
          rescued_at: nowStr
        });

        if (resId) {
          try {
            await updateDoc(doc(db, 'resources', resId), {
              availability: 'available',
              status: 'On Standby'
            });
          } catch (resErr) {
            console.warn('Resource status release warning:', resErr.message);
          }
        }
      } else {
        setRequests(prev =>
          prev.map(r => r.id === reqId ? { ...r, status: 'rescued', rescued_at: nowStr } : r)
        );
      }
    } catch (err) {
      console.error('Error marking rescued:', err);
      alert('Failed to update status: ' + err.message);
    }
  };

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#fff' }}>
        Loading Rescue Portal…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h2>🚒 Raahat Rescue Portal</h2>
          <p>Sign in with your field rescue team credentials</p>

          {authError && <div style={{ color: '#ef4444', marginBottom: '14px', fontSize: '13px' }}>{authError}</div>}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Team Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="team-alpha@raahat.org"
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button type="submit" className="auth-submit-btn">
              Sign In to Rescue Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="rescue-app">
      <header className="rescue-header">
        <div className="rescue-brand">
          🚒 Raahat <span>Rescue Team</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Logged in: <b>{user.email}</b></span>
          <button className="signout-btn" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      <main style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#fff' }}>
            📋 Assigned Emergency Incidents ({requests.filter(r => r.status !== 'rescued').length})
          </h2>
          <span style={{ fontSize: '11px', background: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa', padding: '4px 10px', borderRadius: '999px', fontWeight: 'bold' }}>
            🛰️ Realtime Sync
          </span>
        </div>

        {requests.length === 0 ? (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
            No incidents currently assigned to your team. Standing by for dispatches…
          </div>
        ) : (
          requests.map((r) => {
            const isCritical = r.ai_priority === 'critical' || r.situation === 'stranded' || r.situation === 'injured';
            const isHigh = r.ai_priority === 'high';

            return (
              <div
                key={r.id}
                className={`incident-card ${isCritical ? 'priority-critical' : isHigh ? 'priority-high' : 'priority-normal'}`}
              >
                <div className="incident-card-header">
                  <div>
                    <div className="incident-title">🧑 {r.name} · {r.people_count} people</div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                      Category: <b style={{ color: '#fff' }}>{SITUATION_LABEL[r.situation] || r.situation}</b>
                    </div>
                  </div>
                  <span className={`status-badge ${r.status}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="incident-details">
                  <div>📞 Phone: <b>{r.phone}</b></div>
                  <div>🚨 Priority: <b style={{ color: isCritical ? 'var(--danger)' : isHigh ? 'var(--amber)' : 'var(--safe)', textTransform: 'uppercase' }}>{r.ai_priority || 'normal'}</b></div>
                  {r.lat && r.lng && (
                    <div style={{ gridColumn: 'span 2' }}>📍 Coordinates: <b>{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</b></div>
                  )}
                  {r.notes && (
                    <div style={{ gridColumn: 'span 2', fontStyle: 'italic', background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: '4px', marginTop: '4px' }}>
                      "{r.notes}"
                    </div>
                  )}
                </div>

                <div className="action-buttons-row">
                  {r.status === 'team_assigned' && (
                    <button
                      type="button"
                      className="action-btn dispatch"
                      onClick={() => handleMarkDispatched(r.id)}
                    >
                      🚀 Mark Dispatched
                    </button>
                  )}

                  {(r.status === 'team_assigned' || r.status === 'dispatched') && (
                    <button
                      type="button"
                      className="action-btn rescue"
                      onClick={() => handleMarkRescued(r.id, r.assigned_resource_id)}
                    >
                      💚 Mark Rescued / Safe
                    </button>
                  )}

                  {r.status === 'rescued' && (
                    <div style={{ textAlign: 'center', width: '100%', padding: '8px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--safe)', borderRadius: '6px', fontWeight: 'bold', fontSize: '12px' }}>
                      ✅ Incident Successfully Rescued
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
