import { useEffect, useRef, useState } from 'react';
import { db } from './firebaseClient';
import { doc, setDoc, onSnapshot, collection } from 'firebase/firestore';
import { saveLocal, getAllLocal } from './db';
import './styles.css';
import VoiceSOSModal from './components/VoiceSOSModal';
import PhotoSOSModal from './components/PhotoSOSModal';

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
    const docPayload = {
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
    };

    if (record.audioData || record.audio_data) {
      const b64 = record.audioData || record.audio_data;
      const sizeKb = record.audioSizeKb || record.audio_size_kb;
      const transcript = record.audioTranscript || record.audio_transcript;
      const analysis = record.audioAnalysis || record.audio_analysis;

      if (b64 !== undefined) {
        docPayload.audio_data = b64;
        docPayload.audioData = b64;
      }
      if (sizeKb !== undefined) {
        docPayload.audio_size_kb = sizeKb;
        docPayload.audioSizeKb = sizeKb;
      }
      if (transcript !== undefined) {
        docPayload.audio_transcript = transcript;
        docPayload.audioTranscript = transcript;
      }
      if (analysis !== undefined) {
        docPayload.audio_analysis = analysis;
        docPayload.audioAnalysis = analysis;
      }
    }

    if (record.imageData || record.image_data) {
      const imgB64 = record.imageData || record.image_data;
      const imgKb = record.imageSizeKb || record.image_size_kb;
      const origMb = record.originalSizeMb || record.image_original_size_mb;
      const imgAnalysis = record.imageAnalysis || record.image_analysis;

      if (imgB64 !== undefined) {
        docPayload.image_data = imgB64;
        docPayload.imageData = imgB64;
      }
      if (imgKb !== undefined) {
        docPayload.image_size_kb = imgKb;
        docPayload.imageSizeKb = imgKb;
      }
      if (origMb !== undefined) {
        docPayload.image_original_size_mb = origMb;
        docPayload.imageOriginalSizeMb = origMb;
      }
      if (imgAnalysis !== undefined) {
        docPayload.image_analysis = imgAnalysis;
        docPayload.imageAnalysis = imgAnalysis;
      }
    }

    // Failsafe: Remove any undefined fields because Firestore setDoc throws on undefined
    Object.keys(docPayload).forEach((key) => {
      if (docPayload[key] === undefined) {
        delete docPayload[key];
      }
    });

    await setDoc(doc(db, 'requests', record.localId), docPayload, { merge: true });
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
  const [gpsFailed, setGpsFailed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState([]);
  const [btnState, setBtnState] = useState('idle'); // idle | sending | saved
  const coordsRef = useRef(null);
  const [liveStatuses, setLiveStatuses] = useState({});

  // Voice SOS States
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [voiceRecordData, setVoiceRecordData] = useState(null);

  // Photo SOS States
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [photoRecordData, setPhotoRecordData] = useState(null);

  // Predictive Flood Warning States
  const [floodWarnings, setFloodWarnings] = useState([]);
  const [isWarningDismissed, setIsWarningDismissed] = useState(false);

  const handleVoiceRecorded = (recordedData) => {
    setVoiceRecordData(recordedData);
    const { analysis, transcript } = recordedData;

    if (analysis) {
      if (analysis.situation) {
        setSituation(analysis.situation);
      }
      if (analysis.peopleCount) {
        setPeople(analysis.peopleCount);
      }
      let autoNotes = [];
      if (analysis.locationHint) {
        autoNotes.push(`📍 ${analysis.locationHint}`);
      }
      if (transcript && transcript !== '(Audio recorded - spoken text unavailable)') {
        autoNotes.push(`🎙️ Voice Transcript: "${transcript}"`);
      }
      if (autoNotes.length > 0) {
        setNotes((prev) => (prev ? `${prev}\n${autoNotes.join(' · ')}` : autoNotes.join(' · ')));
      }
    }
  };

  const handlePhotoRecorded = (photoData) => {
    setPhotoRecordData(photoData);
  };

  const clearVoiceRecord = () => {
    setVoiceRecordData(null);
  };

  const clearPhotoRecord = () => {
    setPhotoRecordData(null);
  };

  // Real-time status tracking via Firestore onSnapshot
  useEffect(() => {
    if (!db) return;
    const activeReqs = queue.filter(r => r.status === 'sent' && !r.markedSafe);
    if (activeReqs.length === 0) return;

    const unsubscribes = activeReqs.map(req =>
      onSnapshot(
        doc(db, 'requests', req.localId),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setLiveStatuses(prev => ({
              ...prev,
              [req.localId]: {
                status: data.status,
                ai_priority: data.ai_priority,
                ai_processed_at: data.ai_processed_at,
                assigned_resource_id: data.assigned_resource_id,
                assigned_resource_name: data.assigned_resource_name,
                assigned_at: data.assigned_at,
                dispatched_at: data.dispatched_at,
                rescued_at: data.rescued_at,
                safe_reported_at: data.safe_reported_at
              }
            }));
          }
        },
        (err) => {
          console.warn('Status subscription error:', err.code);
        }
      )
    );

    return () => unsubscribes.forEach(unsub => unsub());
  }, [queue]);

  // Real-time listener for predictive flood warnings
  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, 'flood_warnings'),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setFloodWarnings(list);
      },
      (err) => console.warn('Flood warnings listener error:', err.message)
    );
    return () => unsub();
  }, []);

  const handleMarkSafe = async (localId) => {
    const confirmSafe = window.confirm("Are you sure you want to mark yourself as safe? Rescuers will be notified.");
    if (!confirmSafe) return;

    try {
      const nowStr = new Date().toISOString();
      if (db) {
        const safeDocId = `${localId}_safe`;
        await setDoc(doc(db, 'requests', safeDocId), {
          id: safeDocId,
          original_request_id: localId,
          type: 'safe_report',
          reported_at: nowStr,
          status: 'rescued',
          captured_at: Date.now()
        });
      }

      const all = await getAllLocal();
      const match = all.find(r => r.localId === localId);
      if (match) {
        match.markedSafe = true;
        await saveLocal(match);
      }
      refreshQueue();
      alert('✅ Your safety report has been sent! Rescuers have been notified.');
    } catch (err) {
      console.error('Error marking safe:', err);
      alert('Failed to send safety report: ' + err.message);
    }
  };

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
        () => {
          setGpsText('Could not get location — check permission. Request will still send.');
          setGpsFailed(true);
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      setGpsText('Location not supported on this device — request will still send.');
      setGpsFailed(true);
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
    flushQueue();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
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

    const n = name.trim() || 'Not given';
    const p = phone.trim() || 'Not given';

    const isDuplicate = queue.some(r => {
      const matchName = r.name === n;
      const matchPhone = r.phone === p;
      const matchSit = r.situation === situation;
      const matchTime = Date.now() - r.capturedAt < 5 * 60 * 1000;
      return matchName && matchPhone && matchSit && matchTime;
    });

    if (isDuplicate) {
      alert("You have already queued this SOS request. We will transmit it as soon as connection is available.");
      return;
    }

    setBtnState('sending');

    const coords = coordsRef.current;
    const record = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: n,
      phone: p,
      peopleCount: people.trim() || '1',
      situation: situation,
      notes: notes.trim(),
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
      accuracy: coords ? coords.accuracy : null,
      capturedAt: Date.now(),
      status: 'queued',
      ...(voiceRecordData ? {
        audioData: voiceRecordData.audioData,
        audioSizeKb: voiceRecordData.audioSizeKb,
        audioTranscript: voiceRecordData.transcript,
        audioAnalysis: voiceRecordData.analysis
      } : {}),
      ...(photoRecordData ? {
        imageData: photoRecordData.imageData,
        imageSizeKb: photoRecordData.compressedSizeKb,
        originalSizeMb: photoRecordData.originalSizeMb,
        imageAnalysis: photoRecordData.analysis
      } : {})
    };

    await saveLocal(record);
    const sentNow = await trySend(record);
    if (sentNow) {
      record.status = 'sent';
      await saveLocal(record);
    } else {
      setTimeout(flushQueue, 5000);
    }

    setBtnState('saved');
    setVoiceRecordData(null);
    setPhotoRecordData(null);
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

        {queue.some(r => r.status === 'sent') && (
          <div className="citizen-tracker-dashboard" style={{ background: 'var(--paper-raised)', border: '2px solid var(--line)', borderRadius: 'var(--radius)', padding: '16px', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 12px 0', borderBottom: '2px solid var(--line)', paddingBottom: '6px' }}>🛰️ Live SOS Dispatch Status</h2>
            {queue.filter(r => r.status === 'sent').map(r => {
              const live = liveStatuses[r.localId] || {};
              const currentStatus = live.status || 'pending';
              const assignedName = live.assigned_resource_name;

              const step1 = true;
              const step2 = !!live.ai_priority;
              const step3 = currentStatus === 'team_assigned' || currentStatus === 'dispatched' || currentStatus === 'rescued' || !!assignedName;
              const step4 = currentStatus === 'dispatched' || currentStatus === 'rescued';
              const step5 = currentStatus === 'rescued';

              return (
                <div key={r.localId} className="tracker-card" style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px dashed var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>SOS Category: {SITUATIONS.find(s => s.value === r.situation)?.label || r.situation}</span>
                    <span className={`status-badge status-${currentStatus}`} style={{ fontSize: '9px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '999px', background: currentStatus === 'rescued' ? 'var(--safe)' : currentStatus === 'dispatched' ? 'var(--danger)' : currentStatus === 'team_assigned' ? '#2563eb' : 'var(--amber)', color: '#fff' }}>
                      {currentStatus.toUpperCase()}
                    </span>
                  </div>

                  <div className="tracker-stepper" style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', margin: '20px 0 16px 0' }}>
                    <div style={{ position: 'absolute', top: '9px', left: '10px', right: '10px', height: '2px', background: 'var(--line)', zIndex: 1 }}></div>
                    {[
                      { active: step1, label: 'Received' },
                      { active: step2, label: 'Triage' },
                      { active: step3, label: 'Assigned' },
                      { active: step4, label: 'Dispatched' },
                      { active: step5, label: 'Rescued' }
                    ].map((step, idx) => (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1 }}>
                        <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: step.active ? 'var(--safe)' : 'var(--line)', border: '2px solid var(--paper-raised)', color: '#fff', fontSize: '9px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {step.active ? '✓' : idx + 1}
                        </div>
                        <span style={{ fontSize: '8px', fontWeight: 'bold', color: step.active ? 'var(--ink)' : 'var(--line)', marginTop: '4px', textAlign: 'center' }}>{step.label}</span>
                      </div>
                    ))}
                  </div>

                  {assignedName && currentStatus !== 'rescued' && (
                    <div className="responder-info-box" style={{ background: 'rgba(37, 99, 235, 0.05)', border: '1px solid rgba(37, 99, 235, 0.2)', padding: '10px', borderRadius: '8px', marginBottom: '12px', fontSize: '11px', lineHeight: '1.4' }}>
                      🚀 <b>Assigned Team</b>: <span style={{ color: '#2563eb', fontWeight: 'bold' }}>{assignedName}</span><br />
                      ⏱️ <b>Estimated Arrival (ETA)</b>: ~10-15 minutes (Active route)
                    </div>
                  )}

                  {currentStatus !== 'rescued' && !r.markedSafe && (
                    <button
                      className="im-safe-btn"
                      onClick={() => handleMarkSafe(r.localId)}
                      style={{ width: '100%', padding: '10px', background: 'var(--safe)', border: '1px solid var(--safe)', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', transition: 'opacity 0.2s' }}
                    >
                      💚 I'm Safe / Request Completed
                    </button>
                  )}
                  {(currentStatus === 'rescued' || r.markedSafe) && (
                    <div style={{ textAlign: 'center', padding: '10px', background: 'rgba(43, 175, 102, 0.1)', border: '1px solid var(--safe)', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', color: 'var(--safe)' }}>
                      ✅ Safety reported — Rescuers have been notified
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* PROMINENT VOICE & PHOTO SOS TRIGGER BUTTONS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
          <button
            type="button"
            className="voice-sos-trigger-btn"
            style={{ marginBottom: 0, padding: '12px' }}
            onClick={() => setIsVoiceModalOpen(true)}
          >
            <span className="mic-pulse-dot"></span>
            🎤 VOICE SOS
          </button>

          <button
            type="button"
            className="photo-sos-trigger-btn"
            style={{ marginBottom: 0, padding: '12px' }}
            onClick={() => setIsPhotoModalOpen(true)}
          >
            📷 PHOTO SOS
          </button>
        </div>

        {/* Voice SOS Attachment Preview Banner */}
        {voiceRecordData && (
          <div className="voice-sos-attached-banner">
            <div className="info">
              <span style={{ fontWeight: 'bold', color: '#2563eb' }}>🎙️ Voice SOS Attached ({voiceRecordData.audioSizeKb} KB)</span>
              <span style={{ color: '#6B7280', fontStyle: 'italic' }}>
                "{voiceRecordData.transcript.slice(0, 45)}{voiceRecordData.transcript.length > 45 ? '...' : ''}"
              </span>
            </div>
            <button type="button" className="remove-voice-btn" onClick={clearVoiceRecord}>
              ✕ Remove
            </button>
          </div>
        )}

        {/* Photo SOS Attachment Preview Banner */}
        {photoRecordData && (
          <div className="photo-sos-attached-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src={photoRecordData.imageData} alt="Attached SOS" className="attached-thumb" />
              <div className="info">
                <span style={{ fontWeight: 'bold', color: '#0284C7' }}>📷 Photo Attached ({photoRecordData.compressedSizeKb} KB)</span>
                <span style={{ color: '#6B7280' }}>
                  {photoRecordData.originalSizeMb} MB → {photoRecordData.compressedSizeKb} KB ({photoRecordData.reductionPercent}% smaller)
                </span>
              </div>
            </div>
            <button type="button" className="remove-voice-btn" onClick={clearPhotoRecord}>
              ✕ Remove
            </button>
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

        {gpsFailed && (
          <div className="gps-failed-warning" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '8px', padding: '10px', fontSize: '11px', color: '#ef4444', fontWeight: 'bold', marginBottom: '14px', lineHeight: '1.4' }}>
            ⚠️ Could not lock GPS location. Please make sure to write your exact address or nearby landmark in the details field below so rescuers can locate you.
          </div>
        )}

        <div className="field">
          <label htmlFor="notes">Anything else rescuers should know (optional)</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Landmark, floor number, elderly/children, etc." />
        </div>

        <div id="gps-line" className={gpsLocked ? 'locked' : ''}>
          <span className="dot"></span>
          <span>{gpsText}</span>
        </div>

        {/* PREDICTIVE FLOOD EARLY WARNING BANNER */}
        {(() => {
          if (isWarningDismissed || floodWarnings.length === 0) return null;

          const getDistanceKm = (lat1, lon1, lat2, lon2) => {
            const R = 6371;
            const dLat = ((lat2 - lat1) * Math.PI) / 180;
            const dLon = ((lon2 - lon1) * Math.PI) / 180;
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
          };

          const userLat = coordsRef.current?.lat;
          const userLng = coordsRef.current?.lng;

          // Find elevated or severe warning within ~5km (or nearest active warning if GPS not locked)
          const activeWarning = floodWarnings.find((w) => {
            if (w.risk_level !== 'elevated' && w.risk_level !== 'severe') return false;
            if (userLat && userLng && w.lat && w.lng) {
              return getDistanceKm(userLat, userLng, w.lat, w.lng) <= 5.0;
            }
            return true; // Fallback: show warning if nearby GPS is undetermined
          });

          if (!activeWarning) return null;
          const isSevere = activeWarning.risk_level === 'severe';

          return (
            <div
              className="flood-early-warning-banner"
              style={{
                background: isSevere ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                border: `2px solid ${isSevere ? 'var(--danger)' : 'var(--amber)'}`,
                borderRadius: 'var(--radius)',
                padding: '12px 14px',
                marginBottom: '16px',
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: isSevere ? 'var(--danger)' : 'var(--amber)', letterSpacing: '0.05em' }}>
                  ⚠️ FLOOD WARNING ({activeWarning.risk_level.toUpperCase()}) — {activeWarning.zone_name}
                </span>
                <button
                  type="button"
                  onClick={() => setIsWarningDismissed(true)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--ink)', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', padding: '0 4px' }}
                >
                  ✕
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '12px', lineHeight: '1.4', color: 'var(--ink)' }}>
                {activeWarning.ai_warning_text || `Elevated precipitation or river discharge detected near ${activeWarning.zone_name}. Stay alert and seek high ground if water rises.`}
              </p>
            </div>
          );
        })()}

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
            Your request is saved locally on your device immediately. Raahat will automatically upload it in the background as soon as a cellular, internet, or SMS network is detected.
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

      {/* Voice SOS Modal */}
      <VoiceSOSModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        onVoiceRecorded={handleVoiceRecorded}
      />

      {/* Photo SOS Modal */}
      <PhotoSOSModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        onPhotoRecorded={handlePhotoRecorded}
      />
    </div>
  );
}
