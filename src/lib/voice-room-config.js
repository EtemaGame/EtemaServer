import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const configPath = path.resolve(rootDir, 'data', 'voice-room-config.json');

const DEFAULT_GUILD_CONFIG = {
  enabled: true,
  creatorChannelIds: [],
  categoryId: null,
  roomNameTemplate: 'Sala de {displayName}',
  defaultUserLimit: 0,
  bitrate: null,
  createTextChannel: true,
  textCategoryId: null,
  textNameTemplate: 'chat-{displayName}',
};

const BUILTIN_GUILD_CONFIG = {
  '1447796232603828298': {
    creatorChannelIds: ['1448148973243072623'],
    categoryId: '1448148227793883176',
    roomNameTemplate: 'Sala de {displayName}',
    defaultUserLimit: 0,
    bitrate: 64_000,
    createTextChannel: true,
    textCategoryId: '1448148227793883176',
    textNameTemplate: 'chat-{displayName}',
  },
};

function cloneDefaultGuildConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_GUILD_CONFIG));
}

async function readConfigFile() {
  try {
    const raw = await readFile(configPath, 'utf8');
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

async function writeConfigFile(config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function getVoiceRoomConfig(guildId) {
  const file = await readConfigFile();
  const builtin = BUILTIN_GUILD_CONFIG[guildId] ?? {};
  const guildConfig = file.guilds[guildId] ?? {};

  return {
    ...cloneDefaultGuildConfig(),
    ...builtin,
    ...guildConfig,
    creatorChannelIds: [
      ...new Set([
        ...(builtin.creatorChannelIds ?? []),
        ...(guildConfig.creatorChannelIds ?? []),
      ]),
    ],
  };
}

export async function ensureVoiceRoomConfig(guildId) {
  const file = await readConfigFile();

  if (!file.guilds[guildId]) {
    file.guilds[guildId] = await getVoiceRoomConfig(guildId);
    await writeConfigFile(file);
  }

  return file.guilds[guildId];
}
