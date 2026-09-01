/**
 * BottomNav — Instagram/FB-style bottom navigation bar.
 * Links: Feed, DMs, Notifications, Vault, Account Center.
 */

import { NavLink } from 'react-router-dom';

type Props = {
  unreadDMs?: number;
  unreadNotifs?: number;
};

export default function BottomNav({ unreadDMs = 0, unreadNotifs = 0 }: Props) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <NavLink to="/" end className="nav-item" id="nav-feed">
        <span className="nav-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </span>
        <span className="nav-label">Feed</span>
      </NavLink>

      <NavLink to="/dms" className="nav-item" id="nav-dms">
        <span className="nav-icon nav-badge-wrap">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {unreadDMs > 0 && <span className="nav-badge">{unreadDMs > 9 ? '9+' : unreadDMs}</span>}
        </span>
        <span className="nav-label">DMs</span>
      </NavLink>

      <NavLink to="/notifications" className="nav-item" id="nav-notifications">
        <span className="nav-icon nav-badge-wrap">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {unreadNotifs > 0 && <span className="nav-badge">{unreadNotifs > 9 ? '9+' : unreadNotifs}</span>}
        </span>
        <span className="nav-label">Alerts</span>
      </NavLink>

      <NavLink to="/arena" className="nav-item" id="nav-arena">
        <span className="nav-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 17.5L3 6V3h3l11.5 11.5"/>
            <path d="M13 19l6-6"/>
            <path d="M16 16l4 4"/>
            <path d="M19 21l2-2"/>
          </svg>
        </span>
        <span className="nav-label">Arena</span>
      </NavLink>

      <NavLink to="/account" className="nav-item" id="nav-account">
        <span className="nav-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </span>
        <span className="nav-label">Account</span>
      </NavLink>
    </nav>
  );
}
