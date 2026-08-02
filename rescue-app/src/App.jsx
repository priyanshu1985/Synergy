import { useEffect, useState } from 'react';
import { db, auth } from './firebaseClient';
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet default icon fix
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function ChangeMapView({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, 14);
    }
  }, [center, map]);
  return null;
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getResourceSpeed(type) {
  switch (type ? type.toLowerCase() : '') {
    case 'boat': return 250; // meters/minute (15 km/h)
    case 'ambulance': return 500; // meters/minute (30 km/h)
    default: return 330; // m/min (20 km/h)
  }
}


export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);

  const [resources, setResources] = useState([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedResource, setSelectedResource] = useState(null);
  const [activeMissions, setActiveMissions] = useState([]);
  const [completedMissions, setCompletedMissions] = useState([]);
  const [gpsText, setGpsText] = useState('Acquiring responder GPS...');
  const [responderCoords, setResponderCoords] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);

  const activeMission = activeMissions[0] || null;
  const missionDistance = (activeMission && responderCoords)
    ? Math.round(getDistanceInMeters(responderCoords.lat, responderCoords.lng, activeMission.lat, activeMission.lng))
    : 0;
  const missionETA = (activeMission && selectedResource)
    ? Math.max(1, Math.round(missionDistance / getResourceSpeed(selectedResource.type)) + 2)
    : 0;


  // Network connection state listeners
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Listen to Auth State
  useEffect(() => {
    if (!auth) {
      // Offline/Demo mode bypass
      setUser({ email: 'demo-responder@raahat.org', isDemo: true });
      setAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!email || !password) {
      setAuthError('Please fill in all fields');
      return;
    }
    setSubmitLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
    } else {
      setUser(null);
    }
  };

  // Get responder GPS location to simulate tracking
  useEffect(() => {
    if ('geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          };
          setResponderCoords(coords);
          setGpsText(`Location: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
        },
        () => {
          setGpsText('GPS unavailable (using default station coordinates)');
          setResponderCoords({ lat: 20.5937, lng: 78.9641 });
        },
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      setGpsText('GPS not supported');
    }
  }, []);

  // Fetch all rescue resources (teams/vehicles) from Firestore (only when authenticated)
  useEffect(() => {
    if (!db || !user) return;
    const unsub = onSnapshot(
      collection(db, 'resources'),
      (snap) => {
        const list = [];
        snap.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        setResources(list);
      },
      (err) => {
        console.error('Error fetching resources:', err.message);
      }
    );
    return () => unsub();
  }, [user]);

  // Listen to selected resource object
  useEffect(() => {
    if (!selectedResourceId) {
      setSelectedResource(null);
      return;
    }
    const res = resources.find(r => r.id === selectedResourceId);
    setSelectedResource(res || null);
  }, [selectedResourceId, resources]);

  // Sync responder real-time GPS location back to Firestore & update active request with live coordinates + ETA
  useEffect(() => {
    if (!db || !selectedResourceId || !responderCoords || !user || user.isDemo) return;
    const updateGps = async () => {
      try {
        await updateDoc(doc(db, 'resources', selectedResourceId), {
          latitude: responderCoords.lat,
          longitude: responderCoords.lng,
          last_active: new Date().toISOString()
        });

        if (activeMission && activeMission.lat && activeMission.lng) {
          const dist = getDistanceInMeters(responderCoords.lat, responderCoords.lng, activeMission.lat, activeMission.lng);
          const speed = getResourceSpeed(selectedResource?.type || 'rescue_team');
          const etaVal = Math.max(1, Math.round(dist / speed) + 2); // 2 mins dispatch prep buffer

          await updateDoc(doc(db, 'requests', activeMission.id), {
            assigned_resource_lat: responderCoords.lat,
            assigned_resource_lng: responderCoords.lng,
            eta_minutes: etaVal,
            distance_meters: Math.round(dist)
          });
        }
      } catch (err) {
        console.warn('Failed to update responder coordinates:', err.message);
      }
    };
    updateGps();
  }, [responderCoords, selectedResourceId, user, activeMission, selectedResource]);

  // Listen to missions assigned to this resource (only when authenticated)
  useEffect(() => {
    if (!db || !selectedResourceId || !user) {
      setActiveMissions([]);
      setCompletedMissions([]);
      return;
    }

    const qActive = query(
      collection(db, 'requests'),
      where('assigned_resource_id', '==', selectedResourceId),
      where('status', 'in', ['team_assigned', 'dispatched'])
    );

    const unsubActive = onSnapshot(qActive, (snap) => {
      const list = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      setActiveMissions(list);
    });

    const qCompleted = query(
      collection(db, 'requests'),
      where('assigned_resource_id', '==', selectedResourceId),
      where('status', '==', 'rescued')
    );

    const unsubCompleted = onSnapshot(qCompleted, (snap) => {
      const list = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      setCompletedMissions(list);
    });

    return () => {
      unsubActive();
      unsubCompleted();
    };
  }, [selectedResourceId, user]);

  const handleStartDispatch = async (missionId) => {
    if (!db) return;
    try {
      const nowStr = new Date().toISOString();
      await updateDoc(doc(db, 'requests', missionId), {
        status: 'dispatched',
        dispatched_at: nowStr
      });
      
      await updateDoc(doc(db, 'resources', selectedResourceId), {
        status: 'En-route to dispatch location'
      });
    } catch (err) {
      alert('Error updating status: ' + err.message);
    }
  };

  const handleCompleteRescue = async (missionId) => {
    const confirm = window.confirm("Are you sure this citizen has been safely rescued? This will complete the request.");
    if (!confirm || !db) return;

    try {
      const nowStr = new Date().toISOString();
      
      await updateDoc(doc(db, 'requests', missionId), {
        status: 'rescued',
        rescued_at: nowStr
      });

      await updateDoc(doc(db, 'resources', selectedResourceId), {
        availability: 'available',
        status: 'On Standby'
      });

      alert('✅ Rescue marked as complete! Resource is now back on standby.');
    } catch (err) {
      alert('Error completing rescue: ' + err.message);
    }
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B0F19', color: '#fff' }}>
        Loading RAAHAT Rescue Command...
      </div>
    );
  }

  // Render Login Form if not logged in
  if (!user) {
    return (
      <div className="auth-screen">
        <form onSubmit={handleLoginSubmit} className="auth-card">
          <h1>Raahat <span>Rescue</span></h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '-8px' }}>
            First Responder Field Portal
          </p>

          {authError && <div className="auth-error">{authError}</div>}

          <div className="auth-field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. responder@raahat.org"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="action-btn primary"
            disabled={submitLoading}
            style={{ marginTop: '8px' }}
          >
            {submitLoading ? 'Authenticating...' : 'Sign In as Responder'}
          </button>
        </form>
      </div>
    );
  }



  return (
    <div className="app-container">
      <header>
        <div className="brand">
          Raahat <span>Rescue</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={handleLogout}
            style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            LOGOUT
          </button>
          <div className={`status-badge ${online ? 'online' : 'offline'}`}>
            {online ? 'Online' : 'Offline'}
          </div>
        </div>
      </header>

      <main className="main-content">
        {/* Responder Identity Selector */}
        <div className="selector-card">
          <h2>Select Your Rescue Team / Vehicle</h2>
          <div className="select-wrapper">
            <select
              value={selectedResourceId}
              onChange={(e) => setSelectedResourceId(e.target.value)}
            >
              <option value="">-- Choose First Responder Team --</option>
              {resources.map((res) => (
                <option key={res.id} value={res.id}>
                  {res.name} ({res.type}) [{res.availability}]
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: responderCoords ? 'var(--success)' : 'var(--accent)' }}></span>
            {gpsText}
          </div>
        </div>

        {/* Selected Identity Details */}
        {selectedResource && (
          <div style={{ display: 'flex', gap: '12px', background: 'rgba(37, 99, 235, 0.05)', border: '1px solid rgba(37, 99, 235, 0.2)', padding: '12px', borderRadius: 'var(--radius)', fontSize: '12px' }}>
            <div style={{ flex: 1 }}>
              <b>Status</b>: <span style={{ color: selectedResource.availability === 'available' ? 'var(--success)' : 'var(--accent)', fontWeight: 'bold' }}>{selectedResource.status}</span>
            </div>
            <div>
              <b>Capacity</b>: {selectedResource.capacity} persons
            </div>
          </div>
        )}

        {/* Active Mission Dashboard */}
        {!selectedResourceId ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
            ⚠️ Please select your rescue team identity above to receive live dispatch requests.
          </div>
        ) : activeMission ? (
          <div className="mission-card">
            <div className="mission-header">
              <div className="mission-title">
                🚨 Active Emergency Dispatch
                <span className={`priority-tag ${activeMission.ai_priority || 'normal'}`}>
                  Priority: {activeMission.ai_priority || 'NORMAL'}
                </span>
              </div>
            </div>

            <div className="mission-details">
              <div className="detail-row">
                <span className="detail-label">Citizen Name</span>
                <span className="detail-val">{activeMission.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Contact Phone</span>
                <a href={`tel:${activeMission.phone}`} className="detail-val" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 'bold' }}>
                  📞 {activeMission.phone}
                </a>
              </div>
              <div className="detail-row">
                <span className="detail-label">People in Danger</span>
                <span className="detail-val" style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '16px' }}>
                  👥 {activeMission.people_count}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Emergency Category</span>
                <span className="detail-val" style={{ textTransform: 'capitalize' }}>
                  {activeMission.situation.replace('_', ' ')}
                </span>
              </div>
              {activeMission.notes && (
                <div className="detail-row">
                  <span className="detail-label">Responder Notes & Landmarks</span>
                  <span className="detail-val" style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', fontSize: '13px', border: '1px solid var(--border)' }}>
                    {activeMission.notes}
                  </span>
                </div>
              )}
              {activeMission.ai_flags && activeMission.ai_flags.length > 0 && (
                <div className="detail-row">
                  <span className="detail-label">AI Triage Danger Flags</span>
                  <div className="flags-container">
                    {activeMission.ai_flags.map((flag) => (
                      <span key={flag} className="flag-badge">
                        ⚠️ {flag.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {missionDistance > 0 && (
                <div className="responder-info-box" style={{ background: 'rgba(255, 90, 31, 0.05)', border: '1px solid rgba(255, 90, 31, 0.2)', padding: '10px', borderRadius: '8px', marginTop: '10px', fontSize: '12px', lineHeight: '1.4' }}>
                  📍 <b>Distance to Citizen</b>: {(missionDistance / 1000).toFixed(2)} km ({missionDistance} meters)<br />
                  ⏱️ <b>Estimated Arrival (ETA)</b>: ~{missionETA} mins (via {selectedResource?.type || 'responder'})
                </div>
              )}
            </div>

            {/* Incident Location Map */}
            {activeMission.lat && activeMission.lng && (
              <div className="map-container">
                <MapContainer
                  center={[activeMission.lat, activeMission.lng]}
                  zoom={14}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={false}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <Marker position={[activeMission.lat, activeMission.lng]}>
                    <Popup>SOS Target: {activeMission.name}</Popup>
                  </Marker>
                  {responderCoords && (
                    <>
                      <Marker position={[responderCoords.lat, responderCoords.lng]} icon={L.divIcon({ className: 'responder-dot', html: '<div style="background:#3b82f6;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,0.5)"></div>', iconSize: [12, 12] })}>
                        <Popup>Your Location</Popup>
                      </Marker>
                      <Polyline
                        positions={[
                          [responderCoords.lat, responderCoords.lng],
                          [activeMission.lat, activeMission.lng]
                        ]}
                        pathOptions={{ color: '#FF5A1F', weight: 4, dashArray: '5, 10' }}
                      />
                    </>
                  )}
                  <ChangeMapView center={[activeMission.lat, activeMission.lng]} />
                </MapContainer>
              </div>
            )}

            {/* Actions Panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {activeMission.status === 'team_assigned' ? (
                <button
                  className="action-btn primary"
                  onClick={() => handleStartDispatch(activeMission.id)}
                >
                  🚀 Accept & Start Dispatch
                </button>
              ) : (
                <button
                  className="action-btn success"
                  onClick={() => handleCompleteRescue(activeMission.id)}
                >
                  💚 Mark Citizen as Safe / Rescued
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mission-card none" style={{ border: '1px solid var(--success)', padding: '24px', textAlign: 'center' }}>
            <span style={{ fontSize: '32px' }}>🟢</span>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--success)', marginTop: '8px' }}>On Standby</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              No active rescue assignments. You will automatically receive details here as soon as an SOS is dispatched to your team.
            </p>
          </div>
        )}

        {/* History of Completed Rescues */}
        {selectedResourceId && completedMissions.length > 0 && (
          <div className="history-section">
            <h3>Completed Rescues ({completedMissions.length})</h3>
            <div className="history-list">
              {completedMissions.map((m) => (
                <div className="history-item" key={m.id}>
                  <div className="history-info">
                    <b>{m.name}</b>
                    <span>{m.people_count} people saved</span>
                    <span className="history-time">
                      Rescued: {new Date(m.rescued_at || m.received_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className="history-status">RESCUED ✓</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
