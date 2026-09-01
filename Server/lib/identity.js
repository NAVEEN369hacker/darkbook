/**
 * Identity helpers — DID + UID generation, friendly name picker, password minting.
 *
 * The spec calls for UUIDv7 (time-sortable). The `uuid` package supports v7
 * from version 9 onwards. We use it here.
 */

const { v7: uuidv7 } = require('uuid');
const bcrypt = require('bcryptjs');

// --- friendly handle pools ---
// ~70 adjective + animal pairs. Drawn deterministically per UID so the same
// UID always shows the same handle. (No, it's not "predictable" — the seed
// is the UID itself, which a stranger doesn't know in advance.)
const ANIMALS = [
  'Panda', 'Otter', 'Fox', 'Wolf', 'Owl', 'Lynx', 'Hare', 'Bear',
  'Heron', 'Falcon', 'Whale', 'Seal', 'Swan', 'Raven', 'Hawk', 'Stag',
  'Mouse', 'Bison', 'Crane', 'Marten', 'Capybara', 'Lemur', 'Quokka',
  'Toucan', 'Ibex', 'Yak', 'Newt', 'Stoat', 'Vole', 'Wren', 'Robin',
  'Finch', 'Mole', 'Ferret', 'Cobra', 'Panther', 'Jaguar', 'Tapir',
  'Koala', 'Sloth', 'Lemming', 'Gecko', 'Salamander', 'Caribou',
  'Elk', 'Moose', 'Buffalo', 'Gazelle', 'Meerkat', 'Mongoose',
];
const ADJECTIVES = [
  'Blue', 'Quiet', 'Sunny', 'Sleepy', 'Bold', 'Calm', 'Daring', 'Gentle',
  'Swift', 'Brave', 'Lucky', 'Mellow', 'Cosmic', 'Hidden', 'Silver', 'Golden',
  'Amber', 'Velvet', 'Mossy', 'Misty', 'Dusty', 'Rusty', 'Jolly', 'Witty',
  'Zesty', 'Frosty', 'Stormy', 'Shy', 'Wandering', 'Restless', 'Patient',
  'Curious', 'Earnest', 'Humble', 'Clever', 'Cheery', 'Dusky', 'Emerald',
  'Crimson', 'Ivory', 'Onyx', 'Coral', 'Sage', 'Cobalt', 'Rose',
];

const COLORS = [
  '#3F7CAC', '#7A9CC6', '#E07A5F', '#81B29A', '#F2CC8F',
  '#B5838D', '#5B8E7D', '#3D5A80', '#98C1D9', '#E0FBFC',
  '#A8DADC', '#457B9D', '#1D3557', '#F1FAEE', '#E63946',
  '#F4A261', '#2A9D8F', '#264653', '#E9C46A', '#8338EC',
];

// --- 12-char human-typable password (no 0/O/1/l/I) ---
const PWD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword() {
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += PWD_ALPHABET[Math.floor(Math.random() * PWD_ALPHABET.length)];
  }
  // Insert two dashes at fixed positions for readability: K9p2-vRm4-xQc7
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

// --- seeded PRNG (mulberry32) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// simple FNV-1a hash of a string to a 32-bit integer
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickDisplayName(uid) {
  const rand = mulberry32(hash32(uid));
  const adj = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(rand() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

function pickColor(uid) {
  const rand = mulberry32(hash32(uid + ':color'));
  return COLORS[Math.floor(rand() * COLORS.length)];
}

// --- token: opaque, random. (We are skipping JWT for the basic level.) ---
function generateToken() {
  // 32 random bytes hex = 64 chars. Plenty for an opaque session token.
  const bytes = require('crypto').randomBytes(32);
  return bytes.toString('hex');
}

// --- next UTC midnight ---
function nextMidnightUtc() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return tomorrow.toISOString();
}

// For DEBUG_FAST=1: UIDs expire in 60 seconds so you can watch the rotation.
function computeExpiresAt() {
  if (process.env.DEBUG_FAST === '1') {
    return new Date(Date.now() + 60 * 1000).toISOString();
  }
  return nextMidnightUtc();
}

function generateDid() {
  return `did_${uuidv7()}`;
}
function generateUid() {
  return `uid_${uuidv7()}`;
}
function generatePostId() {
  return `post_${uuidv7()}`;
}
function generateCommentId() {
  return `cmt_${uuidv7()}`;
}
function generateVoteId() {
  return `vote_${uuidv7()}`;
}
function generateReactionId() {
  return `react_${uuidv7()}`;
}

// --- Instagram-style public handle ---
// 1-20 chars, lowercase letters / digits / underscores.
// Must start with a letter. We build it deterministically from the opaque
// `uid` so the same uid always yields the same handle. Format examples:
//   "blue_panda_42"   "swift_otter_3"   "cosmic_capybara"
const HANDLE_MAX = 20;
const HANDLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789_';

function generateHandle(uid) {
  // seed = hash32(uid) → derive indexable words deterministically
  const rand = mulberry32(hash32(uid + ':handle'));
  const adj = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)].toLowerCase();
  const animal = ANIMALS[Math.floor(rand() * ANIMALS.length)].toLowerCase();
  // Strip duplicates and any chars outside the alphabet just to be safe.
  const clean = (s) => s.replace(/[^a-z0-9_]/g, '');
  let core = `${clean(adj)}_${clean(animal)}`;
  // Instagram-style handle: <= 20 chars. If the core fits, use it.
  // Otherwise try a few 3-letter suffixes so two uids don't collide.
  if (core.length <= HANDLE_MAX) return core;
  // Truncate adjective to fit; keeps the underscore + animal tail.
  const animalLen = clean(animal).length + 1; // include underscore
  const maxAdj = HANDLE_MAX - animalLen;
  if (maxAdj > 0) return clean(adj).slice(0, maxAdj) + '_' + clean(animal);
  // Fallback: short random suffix
  const fallback = `${clean(adj).slice(0, 8)}_${Math.floor(rand() * 9999)}`;
  return fallback.slice(0, HANDLE_MAX);
}

// Ensure uniqueness against an existing set of handles. If collide, append
// 1-3 digit suffixes until we find a free slot (or the length budget is
// exhausted — at which point we pad with a random tail).
function ensureUniqueHandle(baseHandle, takenHandles) {
  if (!takenHandles.has(baseHandle)) return baseHandle;
  for (let i = 0; i < 999; i++) {
    const suffix = String(i);
    const candidate = (baseHandle + suffix).slice(0, HANDLE_MAX);
    if (!takenHandles.has(candidate)) return candidate;
  }
  // Last resort
  let rand = Math.random().toString(36).slice(2, 8);
  return (baseHandle.slice(0, HANDLE_MAX - rand.length) + rand).slice(0, HANDLE_MAX);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  generateDid,
  generateUid,
  generatePostId,
  generateCommentId,
  generateVoteId,
  generateReactionId,
  generateHandle,
  ensureUniqueHandle,
  HANDLE_MAX,
  generatePassword,
  generateToken,
  pickDisplayName,
  pickColor,
  computeExpiresAt,
  hashPassword,
  verifyPassword,
};
