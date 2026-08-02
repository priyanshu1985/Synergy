import { useState } from 'react';
import { IncidentCard } from '../ui/IncidentCard';
import { AlertOutlined, SearchOutlined } from '@ant-design/icons';

export function IncidentsPage({ requests, selectedSOS, onSelectSOS }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredRequests = requests.filter(r => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
      {/* Header Bar */}
      <div className="infra-header-bar" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="infra-header-title" style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertOutlined /> Emergency SOS Incidents Operations Center
            </h1>
            <p className="infra-header-sub">
              Live distress calls sorted by AI critical priority and newest submission timestamp.
            </p>
          </div>
          <span style={{ background: 'rgba(255, 77, 79, 0.15)', color: 'var(--red)', padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold' }}>
            {sortedRequests.length} Incidents Found
          </span>
        </div>

        {/* Search & Filter Row */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '260px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SearchOutlined style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by victim name, landmark, situation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '12px', width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
            {['all', 'pending', 'assigned', 'dispatched', 'rescued'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                style={{
                  background: filterStatus === st ? 'var(--orange)' : 'transparent',
                  border: '1px solid var(--border)',
                  color: filterStatus === st ? '#fff' : 'var(--text-secondary)',
                  borderRadius: '999px',
                  padding: '6px 14px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Auto-fit Grid of Incident Cards (minmax(360px, 1fr)) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', width: '100%' }}>
        {sortedRequests.map((r) => (
          <IncidentCard
            key={r.id}
            incident={r}
            isSelected={selectedSOS?.id === r.id}
            onClick={() => onSelectSOS(r)}
          />
        ))}
      </div>
    </div>
  );
}
