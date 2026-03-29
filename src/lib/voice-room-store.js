import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const statePath = path.resolve(rootDir, 'data', 'voice-rooms.json');

function normalizeRoom(room) {
  return {
    ...room,
    textChannelId: room.textChannelId ?? null,
    panelMessageId: room.panelMessageId ?? null,
    allowedMemberIds: [...new Set(room.allowedMemberIds ?? [])],
  };
}

async function readStateFile() {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      version: 1,
      guilds: {},
      ...parsed,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        version: 1,
        guilds: {},
      };
    }

    throw error;
  }
}

async function writeStateFile(state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getGuildRooms(state, guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = { rooms: {} };
  }

  if (!state.guilds[guildId].rooms) {
    state.guilds[guildId].rooms = {};
  }

  return state.guilds[guildId].rooms;
}

export async function listVoiceRooms(guildId) {
  const state = await readStateFile();
  const rooms = getGuildRooms(state, guildId);

  return Object.values(rooms).map((room) => normalizeRoom(room));
}

export async function getVoiceRoom(guildId, channelId) {
  const state = await readStateFile();
  const rooms = getGuildRooms(state, guildId);

  return rooms[channelId] ? normalizeRoom(rooms[channelId]) : null;
}

export async function findVoiceRoomByOwner(guildId, ownerId) {
  const rooms = await listVoiceRooms(guildId);
  return rooms.find((room) => room.ownerId === ownerId) ?? null;
}

export async function saveVoiceRoom(guildId, room) {
  const state = await readStateFile();
  const rooms = getGuildRooms(state, guildId);

  rooms[room.channelId] = normalizeRoom(room);
  await writeStateFile(state);

  return normalizeRoom(room);
}

export async function updateVoiceRoom(guildId, channelId, updater) {
  const state = await readStateFile();
  const rooms = getGuildRooms(state, guildId);
  const current = rooms[channelId];

  if (!current) {
    return null;
  }

  const next = normalizeRoom(updater(structuredClone(current)));
  rooms[channelId] = next;
  await writeStateFile(state);

  return next;
}

export async function removeVoiceRoom(guildId, channelId) {
  const state = await readStateFile();
  const rooms = getGuildRooms(state, guildId);
  const existing = rooms[channelId] ?? null;

  if (!existing) {
    return null;
  }

  delete rooms[channelId];
  await writeStateFile(state);

  return normalizeRoom(existing);
}
