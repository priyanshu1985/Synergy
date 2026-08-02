export function FacilityCard({ title, icon, iconColor = 'blue', location, status, statusColor = 'green', details }) {
  return (
    <div className="facility-card-item">
      <div className="facility-card-head">
        <div className="facility-title">
          <span style={{ color: `var(--${iconColor})` }}>{icon}</span>
          <span>{title}</span>
        </div>
        <span className={`facility-status-pill ${statusColor}`}>{status}</span>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>📍 Location: {location}</div>
      <div className="facility-details-body">
        {details}
      </div>
    </div>
  );
}
