import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const statePath = path.resolve(rootDir, 'data', 'automod-state.json');

function buildDefaultState() {
  return {
    version: 1,
    guilds: {},
  };
}

async function readStateFile() {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...buildDefaultState(),
      ...parsed,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return buildDefaultState();
    }

    throw error;
  }
}

async function writeStateFile(state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getStrikeBucket(state, guildId, userId, scope) {
  state.guilds[guildId] ??= { users: {} };
  state.guilds[guildId].users[userId] ??= { scopes: {} };
  state.guilds[guildId].users[userId].scopes ??= {};
  state.guilds[guildId].users[userId].scopes[scope] ??= [];

  return state.guilds[guildId].users[userId].scopes[scope];
}

export async function peekAutomodStrikeCount(guildId, userId, scope, resetHours) {
  const state = await readStateFile();
  const now = Date.now();
  const resetMs = Math.max(1, resetHours) * 60 * 60 * 1000;
  const bucket = state.guilds[guildId]?.users?.[userId]?.scopes?.[scope] ?? [];
  const activeStrikes = bucket.filter((timestamp) => now - new Date(timestamp).getTime() < resetMs);

  return {
    count: activeStrikes.length,
    resetHours,
    lastAt: activeStrikes.at(-1) ?? null,
  };
}

export async function registerAutomodStrike(guildId, userId, scope, resetHours) {
  const state = await readStateFile();
  const now = Date.now();
  const resetMs = Math.max(1, resetHours) * 60 * 60 * 1000;
  const bucket = getStrikeBucket(state, guildId, userId, scope);
  const activeStrikes = bucket.filter((timestamp) => now - new Date(timestamp).getTime() < resetMs);

  activeStrikes.push(new Date(now).toISOString());
  state.guilds[guildId].users[userId].scopes[scope] = activeStrikes;
  await writeStateFile(state);

  return {
    count: activeStrikes.length,
    resetHours,
    lastAt: activeStrikes.at(-1) ?? null,
  };
}

export async function getAutomodStrikes(guildId, userId, resetHours) {
  const state = await readStateFile();
  const scopes = state.guilds[guildId]?.users?.[userId]?.scopes ?? {};
  const now = Date.now();
  const resetMs = Math.max(1, resetHours) * 60 * 60 * 1000;
  const entries = Object.entries(scopes)
    .map(([scope, timestamps]) => {
      const validTimestamps = Array.isArray(timestamps) ? timestamps : [];
      const activeTimestamps = validTimestamps.filter(
        (timestamp) => now - new Date(timestamp).getTime() < resetMs,
      );

      return {
        scope,
        total: validTimestamps.length,
        active: activeTimestamps.length,
        lastAt: validTimestamps.at(-1) ?? null,
      };
    })
    .filter((entry) => entry.total > 0);

  return {
    resetHours,
    scopes: entries,
    total: entries.reduce((sum, entry) => sum + entry.total, 0),
    active: entries.reduce((sum, entry) => sum + entry.active, 0),
    lastAt: entries
      .map((entry) => entry.lastAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null,
  };
}

export async function clearAutomodStrikes(guildId, userId) {
  const state = await readStateFile();
  const guildState = state.guilds[guildId];
  const userState = guildState?.users?.[userId];

  if (!userState?.scopes) {
    return {
      clearedScopes: 0,
      clearedStrikes: 0,
    };
  }

  const scopeValues = Object.values(userState.scopes).filter(Array.isArray);
  const clearedScopes = scopeValues.length;
  const clearedStrikes = scopeValues.reduce((total, entries) => total + entries.length, 0);

  delete guildState.users[userId];

  if (Object.keys(guildState.users).length === 0) {
    delete state.guilds[guildId];
  }

  await writeStateFile(state);

  return {
    clearedScopes,
    clearedStrikes,
  };
}
