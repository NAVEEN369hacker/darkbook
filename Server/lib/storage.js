/**
 * Storage Abstraction Module for Ghostline Server.
 * Supports Supabase PostgreSQL database when configured, with seamless JSON file fallback.
 */

const fs = require('fs');
const path = require('path');
const { supabase } = require('./db');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function fileFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

// Helpers to convert between JS camelCase and DB snake_case
function toCamel(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  const res = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
    res[camelKey] = obj[key];
  }
  return res;
}

function toSnake(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(toSnake);
  const res = {};
  for (const key of Object.keys(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    res[snakeKey] = obj[key];
  }
  return res;
}

function readAll(collection) {
  ensureDir();
  const file = fileFor(collection);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[storage] failed to read ${collection}:`, err.message);
    return [];
  }
}

function writeAll(collection, rows) {
  ensureDir();
  const file = fileFor(collection);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
}

function find(collection, predicate) {
  return readAll(collection).find(predicate);
}

function filter(collection, predicate) {
  return readAll(collection).filter(predicate);
}

function insert(collection, row) {
  const rows = readAll(collection);
  rows.push(row);
  writeAll(collection, rows);
  if (supabase) {
    supabase.from(collection).upsert(toSnake(row)).then(({ error }) => {
      if (error) console.warn(`[storage] Supabase sync insert '${collection}' warning:`, error.message);
    }).catch((err) => console.error(`[storage] Supabase sync insert error:`, err.message));
  }
  return row;
}

function update(collection, predicate, patch) {
  const rows = readAll(collection);
  let changed = false;
  let updatedRow = null;
  const updated = rows.map((row) => {
    if (predicate(row)) {
      changed = true;
      updatedRow = { ...row, ...patch };
      return updatedRow;
    }
    return row;
  });
  if (changed) {
    writeAll(collection, updated);
    if (supabase && updatedRow) {
      supabase.from(collection).upsert(toSnake(updatedRow)).then(({ error }) => {
        if (error) console.warn(`[storage] Supabase sync update '${collection}' warning:`, error.message);
      }).catch((err) => console.error(`[storage] Supabase sync update error:`, err.message));
    }
  }
  return changed;
}

// --- Async Supabase Enabled Storage Functions ---

async function readAllAsync(collection) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from(collection).select('*');
      if (!error && data) return toCamel(data);
      if (error) console.warn(`[storage] Supabase readAllAsync '${collection}' warning:`, error.message);
    } catch (err) {
      console.error(`[storage] Supabase readAllAsync error:`, err.message);
    }
  }
  return readAll(collection);
}

async function findAsync(collection, queryObj) {
  if (supabase && typeof queryObj === 'object' && !Array.isArray(queryObj)) {
    try {
      const snakeQuery = toSnake(queryObj);
      let builder = supabase.from(collection).select('*');
      for (const [k, v] of Object.entries(snakeQuery)) {
        builder = builder.eq(k, v);
      }
      const { data, error } = await builder.limit(1).single();
      if (!error && data) return toCamel(data);
    } catch (err) {
      // ignore single error if not found
    }
  }
  if (typeof queryObj === 'function') {
    return find(collection, queryObj);
  }
  return find(collection, (row) => {
    return Object.entries(queryObj).every(([k, v]) => row[k] === v);
  });
}

async function insertAsync(collection, row, primaryKey = 'id') {
  if (supabase) {
    try {
      const snakeRow = toSnake(row);
      const { data, error } = await supabase.from(collection).upsert(snakeRow, { onConflict: toSnake({[primaryKey]: true}) ? Object.keys(toSnake({[primaryKey]: true}))[0] : primaryKey }).select();
      if (!error && data && data.length > 0) return toCamel(data[0]);
      if (error) console.warn(`[storage] Supabase insertAsync '${collection}' warning:`, error.message);
    } catch (err) {
      console.error(`[storage] Supabase insertAsync error:`, err.message);
    }
  }
  return insert(collection, row);
}

module.exports = {
  readAll,
  writeAll,
  find,
  filter,
  insert,
  update,
  readAllAsync,
  findAsync,
  insertAsync,
  toCamel,
  toSnake,
  DATA_DIR
};
