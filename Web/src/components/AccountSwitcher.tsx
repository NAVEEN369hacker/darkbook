import { useState, useEffect } from 'react';
import type { Session } from '../storage';
import { adminListAccounts, adminSwitchAccount, Identity } from '../api';
import type { AdminAccount } from '../types';
import IdentityChip from './IdentityChip';

type Props = {
  session: Session;
  onIdentity: (id: Identity) => void;
  onError: (msg: string) => void;
  compact?: boolean;
};

export default function AccountSwitcher({ session, onIdentity, onError, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchingUid, setSwitchingUid] = useState<string | null>(null);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const res = await adminListAccounts(session);
      setAccounts(res.accounts || []);
    } catch (err) {
      console.warn('AccountSwitcher error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchAccounts();
    }
  }, [open]);

  const handleSelectAccount = async (targetUid: string) => {
    if (targetUid === session.uid) {
      setOpen(false);
      return;
    }
    setSwitchingUid(targetUid);
    try {
      const freshIdentity = await adminSwitchAccount(session, targetUid);
      onIdentity(freshIdentity);
      setOpen(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to switch account.');
    } finally {
      setSwitchingUid(null);
    }
  };

  const activeHandleDisplay = session.handle ? `@${session.handle}` : session.displayName;

  return (
    <div className="account-switcher-container">
      <button
        type="button"
        className={`account-switcher-pill ${compact ? 'compact' : ''}`}
        onClick={() => setOpen(true)}
        title="Switch Account (Admin)"
      >
        <span
          className="account-switcher-avatar"
          style={{ backgroundColor: session.colorHex || '#3F7CAC' }}
        />
        <span className="account-switcher-label">{activeHandleDisplay}</span>
        <span className="account-switcher-badge">⚙️ Switch</span>
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-content account-switcher-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Switch Admin Account</h3>
              <button
                type="button"
                className="close-btn"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Instagram-Style Multi-Account Switcher (Admin Only). Instantly switch
              identities to post, comment, and interact under different handles.
            </p>

            {loading ? (
              <p className="muted" style={{ padding: '16px 0', textAlign: 'center' }}>
                Loading accounts…
              </p>
            ) : accounts.length === 0 ? (
              <p className="muted">No other active handles found.</p>
            ) : (
              <div className="account-switcher-list">
                {accounts.map((acc) => {
                  const isActive = acc.uid === session.uid;
                  const isSwitching = switchingUid === acc.uid;
                  return (
                    <div
                      key={acc.uid}
                      className={`account-switcher-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelectAccount(acc.uid)}
                    >
                      <div className="account-switcher-item-left">
                        <IdentityChip
                          displayName={acc.displayName}
                          colorHex={acc.colorHex}
                          handle={acc.handle}
                          navigateToProfile={false}
                        />
                        {acc.handle && (
                          <span className="muted monospace" style={{ fontSize: 12 }}>
                            @{acc.handle}
                          </span>
                        )}
                      </div>

                      <div className="account-switcher-item-right">
                        {isSwitching ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            Switching…
                          </span>
                        ) : isActive ? (
                          <span className="badge badge-active">Active</span>
                        ) : (
                          <span className="link-text" style={{ fontSize: 12 }}>
                            Select
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="modal-footer" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
