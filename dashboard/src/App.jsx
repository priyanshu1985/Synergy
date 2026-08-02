import { useEffect, useState } from 'react';
import { db, auth } from './firebaseClient';
import { collection, query, orderBy, onSnapshot, addDoc, limit } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardHome } from './components/pages/DashboardHome';
import { IncidentsPage } from './components/pages/IncidentsPage';
import { InfrastructurePage } from './components/pages/InfrastructurePage';
import { RiskPredictionPage } from './components/pages/RiskPredictionPage';
import './styles.css';

export default function App() {
  const [requests, setRequests] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [resources, setResources] = useState([]);
  const [floodWarnings, setFloodWarnings] = useState([]);

  // UI States
  const [activeNav, setActiveNav] = useState('dashboard');
  const [selectedSOS, setSelectedSOS] = useState(null);
  const [showFloodWarnings, setShowFloodWarnings] = useState(true);
  const [activeCenter, setActiveCenter] = useState(null);
  const [activeZoom, setActiveZoom] = useState(14);

  // Auth States
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('bala@gamil.com');
  const [password, setPassword] = useState('Balakirshna');
  const [authError, setAuthError] = useState('');
  const [functions, setFunctions] = useState(null);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);

  // Registration Form States
  const [regType, setRegType] = useState('hospital');
  const [regName, setRegName] = useState('');
  const [regLocation, setRegLocation] = useState('');
  const [regLat, setRegLat] = useState('17.4212');
  const [regLng, setRegLng] = useState('78.3478');

  // Auth listener
  useEffect(() => {
    if (!auth) {
      setUser({ email: 'bala@gamil.com', isDemo: true });
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Functions client
  useEffect(() => {
    if (db && user) {
      try {
        setFunctions(getFunctions(db.app));
      } catch (err) {
        console.error('Failed to initialize functions:', err);
      }
    }
  }, [user]);

  // Real live Firestore Subscriptions (0 Mock Data)
  useEffect(() => {
    if (!db || !user) return;

    const unsubscribes = [];
    
    // Live SOS Requests Query
    try {
      const qRequests = query(collection(db, 'requests'), orderBy('captured_at', 'desc'), limit(100));
      unsubscribes.push(
        onSnapshot(qRequests, (snapshot) => {
          const list = [];
          snapshot.docs.forEach((d) => {
            const data = { id: d.id, ...d.data() };
            if (data.type !== 'safe_report') list.push(data);
          });
          setRequests(list);
        }, (err) => {
          console.warn('Ordered query fallback:', err);
          // Fallback simple collection snapshot if index is building
          unsubscribes.push(
            onSnapshot(collection(db, 'requests'), (snap) => {
              const list = [];
              snap.docs.forEach((d) => {
                const data = { id: d.id, ...d.data() };
                if (data.type !== 'safe_report') list.push(data);
              });
              setRequests(list);
            })
          );
        })
      );
    } catch (err) {
      console.error('Firestore requests subscription error:', err);
    }

    // Infrastructure & Telemetry Collections
    unsubscribes.push(onSnapshot(collection(db, 'hospitals'), (snap) => setHospitals(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error(err)));
    unsubscribes.push(onSnapshot(collection(db, 'shelters'), (snap) => setShelters(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error(err)));
    unsubscribes.push(onSnapshot(collection(db, 'resources'), (snap) => setResources(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error(err)));
    unsubscribes.push(onSnapshot(collection(db, 'flood_warnings'), (snap) => setFloodWarnings(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error(err)));

    return () => unsubscribes.forEach(unsub => unsub && unsub());
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

  const handleSelectSOS = (r) => {
    setSelectedSOS(r);
    if (r.lat && r.lng) {
      setActiveCenter([r.lat, r.lng]);
      setActiveZoom(15);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regName.trim() || !regLocation.trim()) return;

    const latVal = parseFloat(regLat) || 17.4212;
    const lngVal = parseFloat(regLng) || 78.3478;

    try {
      const docData = {
        name: regName.trim(),
        location: regLocation.trim(),
        latitude: latVal,
        longitude: lngVal,
        totalBeds: 100,
        availableBeds: 50,
        icuTotal: 10,
        icuAvailable: 5,
        status: 'Operational'
      };

      if (db) {
        await addDoc(collection(db, regType === 'hospital' ? 'hospitals' : 'shelters'), docData);
      }
      setIsRegisterModalOpen(false);
      setRegName('');
      setRegLocation('');
    } catch (err) {
      console.error('Registration error:', err);
    }
  };

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>
        Loading Command Center Dashboard…
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '36px', width: '400px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, #FF4D4F 0%, #FF6A00 100%)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '20px' }}>🏛️</span>
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: 'var(--text-primary)' }}>Raahat Command Center</h2>
              <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Government Disaster Response Portal</p>
            </div>
          </div>

          {authError && (
            <div style={{ background: 'rgba(255, 77, 79, 0.15)', border: '1px solid var(--red)', color: 'var(--red)', padding: '10px', borderRadius: '8px', fontSize: '12px' }}>
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>Responder Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="bala@gamil.com"
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', color: '#fff', borderRadius: '8px', marginTop: '4px', fontSize: '13px', outline: 'none' }}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Balakirshna"
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', color: '#fff', borderRadius: '8px', marginTop: '4px', fontSize: '13px', outline: 'none' }}
                required
              />
            </div>
            <button
              type="submit"
              style={{ padding: '12px', background: 'var(--orange)', border: 'none', color: '#fff', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer', marginTop: '8px', boxShadow: '0 4px 14px var(--orange-glow)' }}
            >
              Sign In to Command Center
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AppLayout activeNav={activeNav} onNavChange={setActiveNav} user={user} onSignOut={handleSignOut}>
      {/* 1. Dashboard Home Page (Default) */}
      {activeNav === 'dashboard' && (
        <DashboardHome
          requests={requests}
          hospitals={hospitals}
          shelters={shelters}
          resources={resources}
          floodWarnings={floodWarnings}
          selectedSOS={selectedSOS}
          onSelectSOS={handleSelectSOS}
          activeCenter={activeCenter}
          activeZoom={activeZoom}
          showFloodWarnings={showFloodWarnings}
          onToggleFloodWarnings={() => setShowFloodWarnings(prev => !prev)}
        />
      )}

      {/* 2. Incidents Operations Center Page */}
      {activeNav === 'incidents' && (
        <IncidentsPage
          requests={requests}
          selectedSOS={selectedSOS}
          onSelectSOS={handleSelectSOS}
        />
      )}

      {/* 3. Infrastructure Page (Renders cleanly inside Content container) */}
      {activeNav === 'infrastructure' && (
        <InfrastructurePage
          hospitals={hospitals}
          shelters={shelters}
          onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
        />
      )}

      {/* 4. Risk Prediction Page */}
      {activeNav === 'risk_prediction' && (
        <RiskPredictionPage floodWarnings={floodWarnings} />
      )}

      {/* Registration Modal */}
      {isRegisterModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>➕ Register New Facility / Team</h3>
            <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Facility Type</label>
                <select value={regType} onChange={(e) => setRegType(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', color: '#fff', borderRadius: '8px', marginTop: '4px' }}>
                  <option value="hospital">Hospital / Clinic</option>
                  <option value="shelter">Relief Shelter</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Name</label>
                <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="e.g. Apex Hospital" style={{ width: '100%', padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', color: '#fff', borderRadius: '8px', marginTop: '4px' }} required />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Location Sector</label>
                <input type="text" value={regLocation} onChange={(e) => setRegLocation(e.target.value)} placeholder="e.g. Sector 4 East" style={{ width: '100%', padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', color: '#fff', borderRadius: '8px', marginTop: '4px' }} required />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" onClick={() => setIsRegisterModalOpen(false)} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ flex: 1, padding: '10px', background: 'var(--orange)', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Save Facility</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
