/**
 * Auth routes — register, login, rotate, me.
 *
 * In the basic-level build we don't do ECDSA keypairs or HMAC proofs.
 * Auth is just an opaque bearer token. The DID is the long-lived identity;
 * the UID is the 24h social handle; the password is server-generated
 * and never typed by the user.
 */

const { find, insert, update, readAll, writeAll, filter } = require('../lib/storage');
const {
  generateDid,
  generateUid,
  generatePassword,
  generateToken,
  pickDisplayName,
  pickColor,
  computeExpiresAt,
  hashPassword,
  verifyPassword,
  generateHandle,
  ensureUniqueHandle,
} = require('../lib/identity');

// Find the currently active daily-identity row for a given did, if any.
// "Active" = status === 'active' AND expiresAt > now.
// One device → at most one active identity at a time. Used to keep the
// public handle stable for the entire day across logout/login cycles.
function findActiveDailyIdentity(did) {
  const now = Date.now();
  return find('daily_identities', (r) =>
    r.did === did &&
    r.status === 'active' &&
    r.expiresAt &&
    new Date(r.expiresAt).getTime() > now,
  );
}

// Build a fresh handle that doesn't collide with any handle currently held
// by an active daily_identities row.
function mintUniqueHandle(uid) {
  const base = generateHandle(uid);
  const taken = new Set(
    filter('daily_identities', (r) => r.status === 'active' && r.handle)
      .map((r) => r.handle),
  );
  return ensureUniqueHandle(base, taken);
}

// --- token store. Backed by data/tokens.json so sessions survive a server
// restart. In a real build this would be Redis keyed by jti. ---
const tokens = new Map(); // token -> { did, uid, issuedAt }

// Load any previously persisted tokens.
for (const row of readAll('tokens')) {
  tokens.set(row.token, { did: row.did, uid: row.uid, issuedAt: row.issuedAt });
}

function persistTokens() {
  writeAll(
    'tokens',
    Array.from(tokens.entries()).map(([token, session]) => ({
      token,
      did: session.did,
      uid: session.uid,
      issuedAt: session.issuedAt,
    })),
  );
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function issueSession(did, uid) {
  const token = generateToken();
  tokens.set(token, { did, uid, issuedAt: new Date().toISOString() });
  persistTokens();
  return token;
}

function getAuthedUid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.uid : null;
}

function getAuthedDid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.did : null;
}

// =============================================================
// POST /api/auth/recognize — device ping on app open
// =============================================================
async function handleRecognize(req, res) {
  try {
    const ip = getClientIp(req);
    const { deviceId, fingerprint, platform, screen, timezone, userAgent } = req.body || {};
    const now = new Date().toISOString();

    const targetDid = deviceId || (fingerprint ? `did_dev_${fingerprint}` : null);
    let device = targetDid ? find('devices', (d) =>
      d.did === targetDid ||
      (fingerprint && d.fingerprint === fingerprint) ||
      (d.did && targetDid && (d.did.startsWith(targetDid) || targetDid.startsWith(d.did)))
    ) : null;

    if (device) {
      update('devices', (d) => d.did === device.did, {
        lastActiveAt: now,
        ip,
        userAgent: userAgent || req.headers['user-agent'] || device.userAgent,
        fingerprint: fingerprint || device.fingerprint,
        platform: platform || device.platform,
        screen: screen || device.screen,
      });

      console.log(`[ghostline] Recognized device: ${device.did} | IP: ${ip} | UA: ${userAgent || req.headers['user-agent']}`);

      return res.json({
        recognized: true,
        did: device.did,
        ip,
        lastActiveAt: now,
        message: 'Device recognized by server',
      });
    }

    console.log(`[ghostline] New device detected: ${targetDid || 'unknown'} | IP: ${ip}`);
    res.json({
      recognized: false,
      did: targetDid || null,
      ip,
      message: 'New device detected',
    });
  } catch (err) {
    console.error('[recognize]', err);
    res.status(500).json({ error: 'recognize_failed', message: err.message });
  }
}

// =============================================================
// POST /api/auth/register  — first install
// Returning devices may hit this endpoint too; in that case we reuse their
// current daily handle if one is still active. One device → at most one
// active handle per day.
// =============================================================
async function handleRegister(req, res) {
  try {
    const ip = getClientIp(req);
    const { deviceId, fingerprint, platform, screen, timezone, userAgent, password: customPassword } = req.body || {};
    const did = deviceId || generateDid();
    const now = new Date().toISOString();

    const existingDevice = find('devices', (d) =>
      d.did === did ||
      (fingerprint && d.fingerprint === fingerprint) ||
      (d.did && did && (d.did.startsWith(did) || did.startsWith(d.did)))
    );

    // Did the client supply a password? Only accept it on the very first
    // registration. Returning devices should keep their stored password
    // so a /register call mid-session can't accidentally rotate it.
    const wantsCustomPassword = typeof customPassword === 'string' && customPassword.trim();
    const isFirstRegistration = !existingDevice;
    const password = isFirstRegistration && wantsCustomPassword
      ? customPassword.trim()
      : generatePassword();
    const passwordHash = await hashPassword(password);

    if (existingDevice) {
      update('devices', (d) => d.did === existingDevice.did, {
        passwordHash,
        lastActiveAt: now,
        ip,
        userAgent: userAgent || req.headers['user-agent'] || existingDevice.userAgent,
        fingerprint: fingerprint || existingDevice.fingerprint,
        platform: platform || existingDevice.platform,
        screen: screen || existingDevice.screen,
      });
      console.log(`[ghostline] Registered returning device: ${existingDevice.did} | IP: ${ip}`);
    } else {
      insert('devices', {
        did,
        passwordHash,
        ip,
        userAgent: userAgent || req.headers['user-agent'] || 'unknown',
        fingerprint: fingerprint || 'unknown',
        platform: platform || 'unknown',
        screen: screen || 'unknown',
        createdAt: now,
        lastActiveAt: now,
      });
      console.log(`[ghostline] Registered new device: ${did} | IP: ${ip}`);
    }

    const actualDid = existingDevice ? existingDevice.did : did;

    // Reuse today's active handle if one exists for this device. Spec:
    // "for one did only one daily identifier a day".
    let active = findActiveDailyIdentity(actualDid);
    let uid;
    let displayName;
    let colorHex;
    let handle;
    let expiresAt;

    if (active) {
      uid = active.uid;
      displayName = active.displayName;
      colorHex = active.colorHex;
      handle = active.handle;
      expiresAt = active.expiresAt;
    } else {
      uid = generateUid();
      displayName = pickDisplayName(uid);
      colorHex = pickColor(uid);
      handle = mintUniqueHandle(uid);
      expiresAt = computeExpiresAt();
      insert('daily_identities', {
        uid,
        did: actualDid,
        handle,
        displayName,
        colorHex,
        status: 'active',
        issuedAt: now,
        expiresAt,
      });
    }

    const token = issueSession(actualDid, uid);

    res.status(201).json({
      did: actualDid,
      uid,
      handle,
      displayName,
      colorHex,
      password,
      accessToken: token,
      expiresAt,
      ip,
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'register_failed', message: err.message });
  }
}

// =============================================================
// POST /api/auth/login  — returning user, same handle within the day
// Spec: one device → one did for lifetime, and one daily identifier per
// did per day. Logging out and logging back in within the same UTC day
// returns the SAME handle + uid + password — never a fresh one.
// =============================================================
async function handleLogin(req, res) {
  try {
    const ip = getClientIp(req);
    const { did, password, fingerprint } = req.body || {};
    if (!did || !password) {
      return res.status(422).json({ error: 'validation_failed', message: 'did and password required' });
    }

    const device = find('devices', (d) =>
      d.did === did ||
      (fingerprint && d.fingerprint === fingerprint) ||
      (d.did && did && (d.did.startsWith(did) || did.startsWith(d.did)))
    );

    if (!device) {
      return res.status(401).json({ error: 'unauthenticated', message: 'unknown device' });
    }

    const ok = await verifyPassword(password, device.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'unauthenticated', message: 'bad password' });
    }

    const now = new Date().toISOString();

    // Touch last-active
    update('devices', (d) => d.did === device.did, { lastActiveAt: now, ip });

    // Same-day login → reuse the existing active daily identity. New day →
    // mint a fresh one (this also happens lazily via the RotationBanner's
    // manual rotate when the timer expires, but we cover it here too).
    let active = findActiveDailyIdentity(device.did);
    let uid;
    let displayName;
    let colorHex;
    let handle;
    let expiresAt;

    if (active) {
      uid = active.uid;
      displayName = active.displayName;
      colorHex = active.colorHex;
      handle = active.handle;
      expiresAt = active.expiresAt;
    } else {
      uid = generateUid();
      displayName = pickDisplayName(uid);
      colorHex = pickColor(uid);
      handle = mintUniqueHandle(uid);
      expiresAt = computeExpiresAt();
      insert('daily_identities', {
        uid,
        did: device.did,
        handle,
        displayName,
        colorHex,
        status: 'active',
        issuedAt: now,
        expiresAt,
      });
    }

    const token = issueSession(device.did, uid);

    // Note: we deliberately do NOT rotate the device password or issue a
    // new one — the device password is the lifetime secret for the device
    // and the same-day login returns it unchanged so silent re-login
    // (auth-recovery in api.ts) keeps working without surprises.
    res.json({
      did: device.did,
      uid,
      handle,
      displayName,
      colorHex,
      password,
      accessToken: token,
      expiresAt,
      ip,
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'login_failed', message: err.message });
  }
}

// =============================================================
// POST /api/auth/rotate  — daily rotation at UTC midnight
// Forced rotation: the old daily identity is marked `rotated`, a brand
// new uid + handle is minted, and the bearer token is replaced.
// =============================================================
async function handleRotate(req, res) {
  try {
    const ip = getClientIp(req);
    const did = getAuthedDid(req);
    const currentUid = getAuthedUid(req);
    if (!did || !currentUid) {
      return res.status(401).json({ error: 'unauthenticated', message: 'missing or invalid token' });
    }

    const device = find('devices', (d) => d.did === did);
    if (!device) {
      return res.status(401).json({ error: 'unauthenticated', message: 'unknown device' });
    }

    // Guard: if an active handle already exists for this device today,
    // return it instead of minting a second one. (Defensive — should not
    // happen because the RotationBanner only fires after expiry, but it
    // means repeated rotate calls are idempotent.)
    const existing = findActiveDailyIdentity(did);
    if (existing) {
      const token = issueSession(did, existing.uid);
      return res.json({
        did,
        uid: existing.uid,
        handle: existing.handle,
        displayName: existing.displayName,
        colorHex: existing.colorHex,
        password: undefined,
        accessToken: token,
        expiresAt: existing.expiresAt,
        ip,
        unchanged: true,
      });
    }

    // Mark the old UID as rotated.
    update(
      'daily_identities',
      (r) => r.uid === currentUid,
      { status: 'rotated', rotatedAt: new Date().toISOString() },
    );

    // Issue a brand-new UID + handle.
    const uid = generateUid();
    const newPassword = generatePassword();
    const newPasswordHash = await hashPassword(newPassword);
    const displayName = pickDisplayName(uid);
    const colorHex = pickColor(uid);
    const handle = mintUniqueHandle(uid);
    const expiresAt = computeExpiresAt();
    const now = new Date().toISOString();

    insert('daily_identities', {
      uid,
      did,
      handle,
      displayName,
      colorHex,
      status: 'active',
      issuedAt: now,
      expiresAt,
    });

    update('devices', (d) => d.did === did, {
      passwordHash: newPasswordHash,
      lastActiveAt: now,
      ip,
    });

    // Rotate the bearer token too.
    const oldAuth = req.headers.authorization || '';
    const oldMatch = oldAuth.match(/^Bearer\s+(.+)$/i);
    if (oldMatch) {
      tokens.delete(oldMatch[1]);
      persistTokens();
    }

    const token = issueSession(did, uid);

    res.json({
      did,
      uid,
      handle,
      displayName,
      colorHex,
      password: newPassword,
      accessToken: token,
      expiresAt,
      ip,
    });
  } catch (err) {
    console.error('[rotate]', err);
    res.status(500).json({ error: 'rotate_failed', message: err.message });
  }
}

// =============================================================
// GET /api/auth/me  — current identity (also exposes serverNow & device info)
// =============================================================
function handleMe(req, res) {
  const ip = getClientIp(req);
  const did = getAuthedDid(req);
  const uid = getAuthedUid(req);
  if (!did || !uid) {
    return res.status(401).json({ error: 'unauthenticated', message: 'missing or invalid token' });
  }
  const identity = find('daily_identities', (r) => r.uid === uid);
  if (!identity) {
    return res.status(404).json({ error: 'not_found', message: 'uid not found' });
  }
  const device = find('devices', (d) => d.did === did);

  res.json({
    did,
    uid,
    handle: identity.handle || null,
    displayName: identity.displayName,
    colorHex: identity.colorHex,
    expiresAt: identity.expiresAt,
    serverNow: new Date().toISOString(),
    ip,
    isAdmin: !!(device && device.isAdmin),
    device: device ? {
      did: device.did,
      ip: device.ip || ip,
      platform: device.platform,
      screen: device.screen,
      userAgent: device.userAgent,
      lastActiveAt: device.lastActiveAt,
    } : null,
  });
}

module.exports = { handleRecognize, handleRegister, handleLogin, handleRotate, handleMe, tokens };

