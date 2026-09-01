// lib/identity.ts — UID/DID/token/password generation + handle/display-name picker.
//
// Deno port of Server/lib/identity.js. The deterministic handle/display-name/
// color logic is preserved exactly so a UID minted by either server keeps the
// same handle/name/color.

import { hash as bcryptHash, compare as bcryptCompare } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

// --- friendly handle pools (mirror Server/lib/identity.js) ---
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

function rand(max: number): number {
  return Math.floor(Math.random() * max);
}

export function generatePassword(): string {
  let out = '';
  for (let i = 0; i < 12; i++) out += PWD_ALPHABET[rand(PWD_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

// --- seeded PRNG (mulberry32) ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickDisplayName(uid: string): string {
  const r = mulberry32(hash32(uid));
  const adj = ADJECTIVES[Math.floor(r() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(r() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

export function pickColor(uid: string): string {
  const r = mulberry32(hash32(uid + ':color'));
  return COLORS[Math.floor(r() * COLORS.length)];
}

export function generateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function nextMidnightUtc(): string {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  )).toISOString();
}

export function computeExpiresAt(): string {
  if (Deno.env.get('DEBUG_FAST') === '1') {
    return new Date(Date.now() + 60_000).toISOString();
  }
  return nextMidnightUtc();
}

// crypto.randomUUID is available in Deno and gives us a uuidv4. The original
// Node code uses uuidv7 (time-sortable) with `did_`/`uid_`/`post_` prefixes.
// UUIDv4 is fine for our purposes (uniqueness, not time-ordering).
export function generateDid(): string {
  return `did_${crypto.randomUUID()}`;
}
export function generateUid(): string {
  return `uid_${crypto.randomUUID()}`;
}
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// --- Instagram-style public handle ---
const HANDLE_MAX = 20;

export function generateHandle(uid: string): string {
  const r = mulberry32(hash32(uid + ':handle'));
  const adj = ADJECTIVES[Math.floor(r() * ADJECTIVES.length)].toLowerCase();
  const animal = ANIMALS[Math.floor(r() * ANIMALS.length)].toLowerCase();
  const clean = (s: string) => s.replace(/[^a-z0-9_]/g, '');
  let core = `${clean(adj)}_${clean(animal)}`;
  if (core.length <= HANDLE_MAX) return core;
  const animalLen = clean(animal).length + 1;
  const maxAdj = HANDLE_MAX - animalLen;
  if (maxAdj > 0) return clean(adj).slice(0, maxAdj) + '_' + clean(animal);
  const fallback = `${clean(adj).slice(0, 8)}_${Math.floor(r() * 9999)}`;
  return fallback.slice(0, HANDLE_MAX);
}

export function ensureUniqueHandle(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 0; i < 999; i++) {
    const suffix = String(i);
    const candidate = (base + suffix).slice(0, HANDLE_MAX);
    if (!taken.has(candidate)) return candidate;
  }
  const tail = Math.random().toString(36).slice(2, 8);
  return (base.slice(0, HANDLE_MAX - tail.length) + tail).slice(0, HANDLE_MAX);
}

export async function hashPassword(password: string): Promise<string> {
  return await bcryptHash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcryptCompare(password, hash);
  } catch {
    return false;
  }
}
