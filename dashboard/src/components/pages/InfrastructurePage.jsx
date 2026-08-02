import { FacilityCard } from '../ui/FacilityCard';
import { HomeOutlined, MedicineBoxOutlined, PlusOutlined } from '@ant-design/icons';

export function InfrastructurePage({ hospitals, shelters, onOpenRegisterModal }) {
  return (
    <div className="infrastructure-page-wrapper">
      {/* Header Bar */}
      <div className="infra-header-bar">
        <div>
          <h1 className="infra-header-title">🏥 Disaster Infrastructure & Emergency Facilities</h1>
          <p className="infra-header-sub">
            Monitored hospitals and relief shelters registered in the command database.
          </p>
        </div>
        <button
          onClick={onOpenRegisterModal}
          style={{
            background: 'var(--orange)',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            padding: '12px 20px',
            fontWeight: '700',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <PlusOutlined /> Register Facility / Team
        </button>
      </div>

      {/* Responsive Cards Grid: auto-fit minmax(360px, 1fr) with 24px Gap */}
      <div className="infra-cards-grid">
        {hospitals.length > 0 ? (
          hospitals.map((h, i) => (
            <FacilityCard
              key={`hosp-p-${i}`}
              title={h.name}
              icon={<MedicineBoxOutlined />}
              iconColor="blue"
              location={h.location || 'Emergency Sector'}
              status={h.status || 'Operational'}
              statusColor="green"
              details={
                <>
                  <div>🛏️ Available Beds: <b>{h.availableBeds || 0} / {h.totalBeds || 0}</b></div>
                  <div>🚨 ICU Capacity: <b>{h.icuAvailable || 0} / {h.icuTotal || 0} available</b></div>
                  <div>⚡ Status: <b>{h.status || 'Operational'}</b></div>
                </>
              }
            />
          ))
        ) : (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            🏥 No registered hospitals found in database. Click + Register Facility to add one.
          </div>
        )}

        {shelters.length > 0 ? (
          shelters.map((s, i) => (
            <FacilityCard
              key={`shelt-p-${i}`}
              title={s.name}
              icon={<HomeOutlined />}
              iconColor="green"
              location={s.location || 'Relief Sector'}
              status={s.status || 'Active'}
              statusColor="green"
              details={
                <>
                  <div>👥 Occupancy: <b>{s.occupied || 0} / {s.capacity || 0} occupied</b></div>
                  <div>🌾 Food Rations: <b>{s.foodStock || 'Adequate'}</b> · Water: <b>{s.waterStock || 'Adequate'}</b></div>
                  <div>🩺 Status: <b>{s.status || 'Active'}</b></div>
                </>
              }
            />
          ))
        ) : (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            🎪 No registered relief shelters found in database. Click + Register Facility to add one.
          </div>
        )}
      </div>
    </div>
  );
}
