import { React } from 'react';
import {
  DashboardOutlined,
  AlertOutlined,
  BankOutlined,
  ThunderboltOutlined,
  LogoutOutlined
} from '@ant-design/icons';

export function AppLayout({ activeNav, onNavChange, user, onSignOut, children }) {
  return (
    <div className="app-layout-wrapper">
      {/* Fixed Sidebar (90px) */}
      <aside className="layout-sidebar">
        <div className="sidebar-logo-box" onClick={() => onNavChange('dashboard')}>
          <ShieldIcon />
        </div>

        <nav className="sidebar-nav-menu">
          <button className={`sidebar-nav-item ${activeNav === 'dashboard' ? 'active' : ''}`} onClick={() => onNavChange('dashboard')}>
            <DashboardOutlined />
            <span>Dashboard</span>
          </button>
          <button className={`sidebar-nav-item ${activeNav === 'incidents' ? 'active' : ''}`} onClick={() => onNavChange('incidents')}>
            <AlertOutlined />
            <span>Incidents</span>
          </button>
          <button className={`sidebar-nav-item ${activeNav === 'infrastructure' ? 'active' : ''}`} onClick={() => onNavChange('infrastructure')}>
            <BankOutlined />
            <span>Infrastructure</span>
          </button>
          <button className={`sidebar-nav-item ${activeNav === 'risk_prediction' ? 'active' : ''}`} onClick={() => onNavChange('risk_prediction')}>
            <ThunderboltOutlined />
            <span>Risk AI</span>
          </button>
        </nav>
      </aside>

      {/* Main Right Layout (Sticky Header + Scrollable Content Container) */}
      <div className="layout-main-wrapper">
        <header className="layout-sticky-header">
          <div className="header-brand-wrap">
            <span className="header-brand-title">Raahat Command Center</span>
            <span className="header-brand-sub">| Government Disaster Management Portal</span>
          </div>

          <div className="header-user-actions">
            <div className="user-status-pill">
              <span className="status-dot-animated"></span>
              <span>{user?.email || 'command@raahat.gov.in'}</span>
            </div>
            <button className="header-signout-btn" onClick={onSignOut}>
              <LogoutOutlined style={{ marginRight: 4 }} /> Sign Out
            </button>
          </div>
        </header>

        {/* Content Container (Independent Scroll) */}
        <main className="layout-content-area">
          {children}
        </main>
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L3 6V12C3 17.55 7.16 21.74 12 23C16.84 21.74 21 17.55 21 12V6L12 2Z" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7V17" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 11L12 15L16 11" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
