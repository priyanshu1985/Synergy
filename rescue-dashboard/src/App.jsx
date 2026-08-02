import { useEffect, useState } from 'react';
import { db, auth } from './firebaseClient';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  AlertOutlined,
  CompassOutlined,
  CheckCircleOutlined,
  PhoneOutlined,
  EnvironmentOutlined
} from '@ant-design/icons';
import './styles.css';

const SITUATION_LABEL = {
  stranded: 'Stranded / Water Rising',
  injured: 'Injured Person',
  supplies: 'Needs Food / Water',
  evacuate: 'Needs Evacuation'
};

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('test_admin@raahat.org');
  const [password, setPassword] = useState('password123');
  const [authError, setAuthError] = useState('');
  const [requests, setRequests] = useState([]);
  const [activeNav, setActiveNav] = useState('assigned');

  useEffect(() => {
    if (!auth) {
      setUser({ email: 'test_admin@raahat.org', isDemo: true });
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!db || !user) return;

    const unsub = onSnapshot(
      collection(db, 'requests'),
      (snap) => {
        const list = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (
            (data.status === 'team_assigned' || data.status === 'dispatched') &&
            data.type !== 'safe_report'
          ) {
            list.push({ id: docSnap.id, ...data });
          }
        });
        setRequests(list);
      },
      (err) => console.error('Firestore rescue requests listener error:', err)
    );

    return () => unsub();
  }, [user]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (!auth) {
        setUser({ email, isDemo: true });
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
      }
    } catch (err) {
      console.error('Error marking dispatched:', err);
    }
  };

  const handleMarkRescued = async (reqId) => {
    const nowStr = new Date().toISOString();
    try {
      if (db) {
        await updateDoc(doc(db, 'requests', reqId), {
          status: 'rescued',
          rescued_at: nowStr
        });
      }
    } catch (err) {
      console.error('Error marking rescued:', err);
    }
  };

  if (authLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>Loading Rescue Portal…</div>;
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '36px', width: '380px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, #FF4D4F 0%, #FF6A00 100%)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '20px' }}>🚒</span>
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Raahat Rescue Portal</h2>
              <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Field Rescue Team Authentication</p>
            </div>
          </div>

          {authError && (
            <div style={{ background: 'rgba(255, 77, 79, 0.15)', border: '1px solid var(--red)', color: 'var(--red)', padding: '10px', borderRadius: '8px', fontSize: '12px' }}>
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>Team Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="test_admin@raahat.org" style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', color: '#fff', borderRadius: '8px', marginTop: '4px', fontSize: '13px', outline: 'none' }} required />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', color: '#fff', borderRadius: '8px', marginTop: '4px', fontSize: '13px', outline: 'none' }} required />
            </div>
            <button type="submit" style={{ padding: '12px', background: 'var(--orange)', border: 'none', color: '#fff', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer', marginTop: '8px', boxShadow: '0 4px 14px var(--orange-glow)' }}>Sign In to Rescue Portal</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout-wrapper">
      {/* Sidebar */}
      <aside className="layout-sidebar">
        <div className="sidebar-logo-box">
          <AlertOutlined style={{ fontSize: 22, color: '#fff' }} />
        </div>
        <nav className="sidebar-nav-menu">
          <button className={`sidebar-nav-item ${activeNav === 'assigned' ? 'active' : ''}`} onClick={() => setActiveNav('assigned')}>
            <AlertOutlined />
            <span>Assigned</span>
          </button>
        </nav>
      </aside>

      {/* Main Right Layout */}
      <div className="layout-main-wrapper">
        <header className="layout-sticky-header">
          <span className="header-brand-title">🚒 Raahat Rescue Team Portal</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 'bold' }}>🟢 Team: {user.email}</span>
            <button className="header-signout-btn" onClick={handleSignOut}>Sign Out</button>
          </div>
        </header>

        {/* Content Area (Independent Scroll) */}
        <main className="layout-content-area">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>📋 Field Dispatch Operations</h1>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Real-time assigned incidents requiring immediate field response.</p>
              </div>
              <span style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--green)', padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold' }}>
                Active Incidents ({requests.filter(r => r.status !== 'rescued').length})
              </span>
            </div>

            {/* Responsive Grid of Cards minmax(340px, 1fr) */}
            <div className="rescue-card-grid">
              {requests.length > 0 ? requests.map((r) => {
                const isDispatched = r.status === 'dispatched';

                return (
                  <div key={r.id} className="rescue-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>🚨 {r.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          👥 {r.people_count || 1} people · {SITUATION_LABEL[r.situation] || r.situation}
                        </div>
                      </div>
                      <span style={{ background: isDispatched ? 'rgba(255, 77, 79, 0.2)' : 'rgba(59, 130, 246, 0.2)', color: isDispatched ? 'var(--red)' : 'var(--blue)', fontSize: '10px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px', textTransform: 'uppercase' }}>
                        {r.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', lineHeight: '1.4' }}>
                      📝 {r.notes || 'Emergency situation requiring rescue assistance.'}
                    </div>

                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <span><EnvironmentOutlined /> {r.lat ? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` : '17.4212, 78.3478'}</span>
                      <span><PhoneOutlined /> {r.phone || '9100885639'}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                      {!isDispatched ? (
                        <button onClick={() => handleMarkDispatched(r.id)} style={{ flex: 1, padding: '10px', background: 'var(--blue)', border: 'none', color: '#fff', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                          🚀 Dispatch Squad Now
                        </button>
                      ) : (
                        <button onClick={() => handleMarkRescued(r.id)} style={{ flex: 1, padding: '10px', background: 'var(--green)', border: 'none', color: '#fff', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                          <CheckCircleOutlined /> Mark Rescued & Safe
                        </button>
                      )}
                    </div>
                  </div>
                );
              }) : (
                <div style={{ gridColumn: '1 / -1', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  📋 No active assigned rescue dispatches at this moment.
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
