import { useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { StatCard } from '../ui/StatCard';
import { IncidentCard } from '../ui/IncidentCard';
import {
  ThunderboltOutlined,
  WarningOutlined,
  TeamOutlined,
  MedicineBoxOutlined,
  HomeOutlined,
  RiseOutlined,
  AlertOutlined,
  SearchOutlined,
  CompassOutlined,
  BellOutlined
} from '@ant-design/icons';

function ChangeMapView({ center, zoom }) {
  const map = useMap();
  if (center && center[0] && center[1]) {
    map.setView(center, zoom || 14);
  }
  return null;
}

export function DashboardHome({
  requests = [],
  hospitals = [],
  shelters = [],
  resources = [],
  floodWarnings = [],
  selectedSOS,
  onSelectSOS,
  activeCenter,
  activeZoom,
  showFloodWarnings,
  onToggleFloodWarnings
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const criticalCount = requests.filter(r => (r.ai_priority === 'critical' || r.situation === 'injured' || r.situation === 'stranded') && r.status !== 'rescued').length;
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const rescuedCount = requests.filter(r => r.status === 'rescued').length;
  const activeSOSCount = requests.filter(r => r.status !== 'rescued').length;

  const totalBeds = hospitals.reduce((acc, h) => acc + (h.totalBeds || 0), 0);
  const availableBeds = hospitals.reduce((acc, h) => acc + (h.availableBeds || 0), 0);
  const shelterCapacity = shelters.reduce((acc, s) => acc + (s.capacity || 0), 0);
  const occupiedShelter = shelters.reduce((acc, s) => acc + (s.occupied || 0), 0);
  const availableResourcesCount = resources.filter(res => res.availability === 'available').length;
  const busyResourcesCount = resources.filter(res => res.availability === 'busy' || res.availability === 'assigned').length;

  const filteredRequests = (requests || []).filter(r => {
    const matchesFilter = filterStatus === 'all' || r.status === filterStatus;
    const matchesSearch = searchQuery === '' ||
      (r.name && r.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.notes && r.notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.situation && r.situation.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const sortedRequests = [...filteredRequests].sort((a, b) => {
    const aIsCritical = a.ai_priority === 'critical' || a.situation === 'injured' || a.situation === 'stranded';
    const bIsCritical = b.ai_priority === 'critical' || b.situation === 'injured' || b.situation === 'stranded';

    if (aIsCritical && !bIsCritical) return -1;
    if (!aIsCritical && bIsCritical) return 1;

    const aTime = a.captured_at ? new Date(a.captured_at).getTime() : 0;
    const bTime = b.captured_at ? new Date(b.captured_at).getTime() : 0;
    return bTime - aTime;
  });

  const withLoc = sortedRequests.filter(r => r.lat && r.lng);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. Statistics Row (12-column span, auto-fit minmax 210px) */}
      <div className="stat-cards-grid">
        <StatCard title="Active SOS" value={activeSOSCount} icon={<ThunderboltOutlined />} color="orange" />
        <StatCard title="Critical SOS" value={criticalCount} icon={<WarningOutlined />} color="red" />
        <StatCard title="Available Resources" value={availableResourcesCount} icon={<TeamOutlined />} color="purple" />
        <StatCard title="Hospital Beds" value={`${availableBeds} / ${totalBeds}`} icon={<MedicineBoxOutlined />} color="green" />
        <StatCard title="Shelter Capacity" value={`${occupiedShelter} / ${shelterCapacity}`} icon={<HomeOutlined />} color="green" />
        <StatCard title="Disaster Severity" value={criticalCount > 0 ? "CRITICAL LEVEL" : "ELEVATED ALERT"} icon={<RiseOutlined />} color={criticalCount > 0 ? "red" : "orange"} />
        <StatCard title="Early Warnings" value={`${floodWarnings.length} Active Zones`} icon={<AlertOutlined />} color="purple" onClick={onToggleFloodWarnings} />
      </div>

      {/* 2. Main Grid Row: Map (span 8) + SOS Queue Panel (span 4) */}
      <div className="grid-12">
        {/* Leaflet Satellite Dark Map Container (span 8) */}
        <div className="col-span-8">
          <div className="map-component-wrap">
            <MapContainer center={activeCenter || [17.4212, 78.3478]} zoom={activeZoom} style={{ height: '100%', width: '100%' }}>
              <ChangeMapView center={activeCenter} zoom={activeZoom} />
              <TileLayer
                attribution="&copy; Google Maps"
                url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                maxZoom={20}
              />

              {/* Real SOS Markers */}
              {withLoc.map((r) => {
                const isCritical = r.ai_priority === 'critical' || r.situation === 'injured' || r.situation === 'stranded';
                const color = r.status === 'rescued' ? '#22C55E' : isCritical ? '#FF4D4F' : '#FF6A00';

                return (
                  <CircleMarker
                    key={r.id}
                    center={[r.lat, r.lng]}
                    radius={isCritical ? 16 : 10}
                    pathOptions={{ color: '#0B1015', weight: 2, fillColor: color, fillOpacity: 0.85 }}
                  >
                    <Popup>
                      <div style={{ color: '#0B1015', padding: '4px', fontSize: '11px' }}>
                        <b>🚨 {r.name}</b> ({r.people_count} people)<br />
                        Status: <b style={{ color }}>{r.status?.toUpperCase()}</b>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {/* Real Hospital Markers */}
              {hospitals.map((h, i) => (
                <CircleMarker key={`hosp-${i}`} center={[h.latitude || 17.4225, h.longitude || 78.3490]} radius={11} pathOptions={{ color: '#0B1015', weight: 2, fillColor: '#3B82F6', fillOpacity: 0.95 }}>
                  <Popup>
                    <div style={{ color: '#0B1015', padding: '4px', fontSize: '11px' }}>
                      <b>🏥 {h.name}</b><br />
                      Beds: {h.availableBeds} / {h.totalBeds}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* Early Warning Flood Markers */}
              {showFloodWarnings && floodWarnings.map((w, i) => (
                <CircleMarker key={`fw-${i}`} center={[w.lat || 17.425, w.lng || 78.35]} radius={14} pathOptions={{ color: '#0B1015', weight: 2, fillColor: '#8B5CF6', fillOpacity: 0.75 }}>
                  <Popup>
                    <div style={{ color: '#0B1015', padding: '4px', fontSize: '11px' }}>
                      <b>🌊 Flood Warning: {w.zone_name}</b><br />
                      Risk: <b>{w.risk_level}</b>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>

            {/* Floating Map Legend */}
            <div className="map-legend-box">
              <div className="legend-row"><span className="legend-indicator" style={{ background: '#FF4D4F' }}></span> Critical SOS</div>
              <div className="legend-row"><span className="legend-indicator" style={{ background: '#FF6A00' }}></span> Active SOS</div>
              <div className="legend-row"><span className="legend-indicator" style={{ background: '#22C55E' }}></span> Rescued / Safe</div>
              <div className="legend-row"><span className="legend-indicator" style={{ background: '#3B82F6' }}></span> 🏥 Hospitals</div>
              <div className="legend-row"><span className="legend-indicator" style={{ background: '#059669' }}></span> 🎪 Shelters</div>
              <div className="legend-row"><span className="legend-indicator" style={{ background: '#8B5CF6' }}></span> 🌊 Flood Risk Zone</div>
            </div>
          </div>
        </div>

        {/* SOS Incident Queue Panel (span 4) */}
        <div className="col-span-4">
          <div className="sos-panel-wrap">
            <div className="sos-panel-header">
              <span className="sos-panel-title">
                <AlertOutlined style={{ color: 'var(--red)' }} /> Emergency SOS Queue ({activeSOSCount})
              </span>
              <span style={{ fontSize: '9px', fontWeight: '800', background: 'rgba(255, 77, 79, 0.15)', color: 'var(--red)', padding: '2px 6px', borderRadius: '4px' }}>
                LIVE SYNC
              </span>
            </div>

            <div className="sos-counter-pills">
              <div className="counter-pill-card">
                <span className="counter-pill-num red">{criticalCount}</span>
                <span className="counter-pill-txt">Critical</span>
              </div>
              <div className="counter-pill-card">
                <span className="counter-pill-num orange">{pendingCount}</span>
                <span className="counter-pill-txt">Pending</span>
              </div>
              <div className="counter-pill-card">
                <span className="counter-pill-num green">{rescuedCount}</span>
                <span className="counter-pill-txt">Rescued</span>
              </div>
            </div>

            {/* Search Input */}
            <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SearchOutlined style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search incident, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '11px', width: '100%' }}
              />
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: '4px', overflowX: 'auto' }}>
              {['all', 'pending', 'assigned', 'dispatched', 'rescued'].map((st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  style={{
                    background: filterStatus === st ? 'var(--orange)' : 'transparent',
                    border: '1px solid var(--border)',
                    color: filterStatus === st ? '#fff' : 'var(--text-secondary)',
                    borderRadius: '999px',
                    padding: '3px 10px',
                    fontSize: '10px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>

            {/* Scrollable Incident Cards List */}
            <div className="incident-scroll-list">
              {sortedRequests.length > 0 ? (
                sortedRequests.map((r) => (
                  <IncidentCard
                    key={r.id}
                    incident={r}
                    isSelected={selectedSOS?.id === r.id}
                    onClick={() => onSelectSOS(r)}
                  />
                ))
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  🚨 No active SOS requests matching selected filter.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Analytics Row (3 Equal Cards: span 4 each - 100% Live Firestore Calculations) */}
      <div className="grid-12">
        <div className="col-span-4">
          <div className="analytics-card-item">
            <div className="analytics-title-bar">
              <ThunderboltOutlined style={{ color: 'var(--green)' }} /> Live Activity Timeline
            </div>
            <div className="analytics-body-content">
              {sortedRequests.slice(0, 3).map((req, idx) => (
                <div key={`act-${idx}`} style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '9.5px' }}>
                    {req.captured_at ? new Date(req.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                  </span>
                  <span style={{ color: req.ai_priority === 'critical' ? 'var(--red)' : 'var(--orange)' }}>●</span>
                  <span>SOS from {req.name || 'Citizen'} ({req.people_count || 1} people)</span>
                </div>
              ))}
              {sortedRequests.length === 0 && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No recent SOS activity recorded.</div>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-4">
          <div className="analytics-card-item">
            <div className="analytics-title-bar">
              <CompassOutlined style={{ color: 'var(--blue)' }} /> Resource Status Overview
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', height: '100%', alignItems: 'center' }}>
              <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 4px', textAlign: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>🟢 Available</span>
                <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--green)' }}>{availableResourcesCount}</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 4px', textAlign: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>🟠 In Use</span>
                <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--orange)' }}>{busyResourcesCount}</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 4px', textAlign: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>👥 Total</span>
                <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)' }}>{resources.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-4">
          <div className="analytics-card-item">
            <div className="analytics-title-bar">
              <BellOutlined style={{ color: 'var(--purple)' }} /> Active Telemetry Warnings
            </div>
            <div className="analytics-body-content">
              {floodWarnings.length > 0 ? (
                floodWarnings.slice(0, 3).map((w, idx) => (
                  <div key={`alert-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', background: 'rgba(0,0,0,0.15)', padding: '6px 10px', borderRadius: '6px' }}>
                    <span>🌊 {w.zone_name} — {w.risk_level?.toUpperCase()}</span>
                    <span style={{ color: 'var(--purple)', fontSize: '9.5px', fontWeight: 'bold' }}>ACTIVE</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '6px' }}>
                  ⚡ All disaster sectors evaluating normal.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
