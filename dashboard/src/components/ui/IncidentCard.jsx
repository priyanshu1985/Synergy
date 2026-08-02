import { WarningOutlined, EnvironmentOutlined, PhoneOutlined, CameraOutlined, AudioOutlined, RocketOutlined } from '@ant-design/icons';

export function IncidentCard({ incident, isSelected, onClick }) {
  const isCritical = incident.ai_priority === 'critical' || incident.situation === 'injured' || incident.situation === 'stranded';
  const isEscalated = isCritical || incident.status === 'escalated';

  const situationLabel = {
    stranded: 'Stranded / Water Rising',
    injured: 'Injured Person',
    supplies: 'Needs Food / Water',
    evacuate: 'Needs Evacuation'
  }[incident.situation] || incident.situation || 'Disaster Distress';

  const formattedTime = incident.captured_at
    ? new Date(incident.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '12:07 PM';

  return (
    <div className={`incident-card-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="incident-card-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <WarningOutlined style={{ color: 'var(--red)', fontSize: '13px' }} />
          <span className="incident-name">{incident.name || 'Emergency SOS'}</span>
          {isEscalated && <span className="badge-tag red">ESCALATED</span>}
          <span className="badge-tag red" style={{ background: 'rgba(255, 77, 79, 0.25)', border: 'none' }}>
            Score {isCritical ? 100 : 75}
          </span>
        </div>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>
          {formattedTime}
        </span>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>
        {incident.people_count || 1} {Number(incident.people_count) === 1 ? 'person' : 'people'} · {situationLabel}
      </div>

      <div className="ai-summary-callout">
        <b>AI:</b> {incident.ai_summary || `CRITICAL — Critical: ${situationLabel} with ${incident.people_count || 1} people needing rescue.`}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
        <span><EnvironmentOutlined style={{ color: 'var(--red)', marginRight: 3 }} /> {incident.lat ? `${Number(incident.lat).toFixed(4)}, ${Number(incident.lng).toFixed(4)}` : '17.4212, 78.3478'}</span>
        <span><PhoneOutlined style={{ color: 'var(--blue)', marginRight: 3 }} /> {incident.phone || '9100885639'}</span>
      </div>

      {/* Hazard chips & Attachment Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' }}>
        {(incident.ai_flags?.includes('structural_danger') || incident.situation === 'stranded') && (
          <span style={{ background: 'rgba(255, 77, 79, 0.15)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px' }}>
            🔴 STRUCTURAL DANGER
          </span>
        )}
        {incident.image_data && (
          <span style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid var(--blue)', color: 'var(--blue)', fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <CameraOutlined /> PHOTO ATTACHED
          </span>
        )}
        {incident.audio_data && (
          <span style={{ background: 'rgba(139, 92, 246, 0.15)', border: '1px solid var(--purple)', color: 'var(--purple)', fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <AudioOutlined /> VOICE SOS
          </span>
        )}
        {incident.assigned_resource_name && (
          <span style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid var(--green)', color: 'var(--green)', fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <RocketOutlined /> {incident.assigned_resource_name}
          </span>
        )}
      </div>
    </div>
  );
}
