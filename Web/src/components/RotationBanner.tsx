import { useEffect, useRef, useState } from 'react';

type Props = {
  expiresAt: string;
  onExpire: () => Promise<void>;
};

/**
 * A live countdown to the next UID rotation.
 *
 * - ticks every second
 * - color shifts warn (yellow) → alert (red) as it approaches zero
 * - when the countdown hits zero, calls onExpire() once and switches
 *   into "rotating" state until the parent updates the session
 */
export default function RotationBanner({ expiresAt, onExpire }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());
  const firedRef = useRef(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0 && !firedRef.current) {
      firedRef.current = true;
      setRotating(true);
      onExpire().finally(() => {
        // Reset the latch when the parent supplies a new session/expiresAt.
        firedRef.current = false;
        setRotating(false);
      });
    }
  }, [now, expiresAt, onExpire]);

  const ms = Math.max(0, new Date(expiresAt).getTime() - now);
  const hh = Math.floor(ms / 3_600_000);
  const mm = Math.floor((ms % 3_600_000) / 60_000);
  const ss = Math.floor((ms % 60_000) / 1000);

  let cls = 'rotation-banner';
  if (rotating || ms <= 0) cls += ' expired';
  else if (ms < 5 * 60_000) cls += ' alert';
  else if (ms < 60 * 60_000) cls += ' warn';

  return (
    <div className={cls}>
      {rotating
        ? 'Rotating your handle…'
        : ms <= 0
          ? 'Rotating your handle…'
          : (
            <>
              Today's handle changes in
              <span className="countdown">
                {String(hh).padStart(2, '0')}:
                {String(mm).padStart(2, '0')}:
                {String(ss).padStart(2, '0')}
              </span>
            </>
          )}
    </div>
  );
}
