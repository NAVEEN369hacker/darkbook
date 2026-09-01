/**
 * Small chip showing the user's friendly handle + color dot.
 * Reused in Home, Feed, Welcome.
 *
 * If a `handle` is provided AND `onClick` / `navigateTo` is given, the
 * chip becomes a button that navigates to the user's public profile
 * (`/u/:handle`). When no navigation is requested the chip stays as a
 * plain div (so it's safe to drop anywhere).
 */

import { useNavigate } from 'react-router-dom';

type Props = {
  displayName: string;
  colorHex: string;
  size?: 'normal' | 'large';
  handle?: string | null;
  /** When provided, the chip becomes a button navigating to `/u/:handle`. */
  navigateToProfile?: boolean;
  /** Optional id override so callers can target the chip in tests. */
  id?: string;
};

export default function IdentityChip({
  displayName,
  colorHex,
  size = 'normal',
  handle,
  navigateToProfile = false,
  id,
}: Props) {
  const navigate = useNavigate();

  const onActivate = (e: React.MouseEvent) => {
    if (!navigateToProfile || !handle) return;
    e.preventDefault();
    e.stopPropagation();
    navigate(`/u/${encodeURIComponent(handle)}`);
  };

  if (navigateToProfile && handle) {
    return (
      <button
        type="button"
        className="identity-chip identity-chip-clickable"
        style={size === 'large' ? { fontSize: 22 } : undefined}
        onClick={onActivate}
        id={id}
        aria-label={`Open profile for @${handle}`}
      >
        <span className="identity-dot" style={{ background: colorHex }} />
        <span>{displayName}</span>
      </button>
    );
  }

  return (
    <div
      className="identity-chip"
      style={size === 'large' ? { fontSize: 22 } : undefined}
      id={id}
    >
      <span className="identity-dot" style={{ background: colorHex }} />
      <span>{displayName}</span>
    </div>
  );
}