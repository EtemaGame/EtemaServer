import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const configPath = path.resolve(rootDir, 'data', 'automod-config.json');

const DEFAULT_GUILD_CONFIG = {
  enabled: true,
  ignoredChannelIds: [],
  ignoredRoleIds: [],
  exemptUserIds: [],
  blockedWords: [],
  links: {
    mode: 'allow',
  },
  flood: {
    enabled: true,
    maxMessages: 6,
    windowSeconds: 8,
    duplicateMessages: 3,
    duplicateWindowSeconds: 20,
    action: 'timeout',
    timeoutMinutes: 10,
    deleteMessage: true,
  },
  joinGuard: {
    enabled: true,
    minAccountAgeHours: 24,
    action: 'log',
    timeoutMinutes: 60,
  },
  escalation: {
    enabled: true,
    resetHours: 72,
    timeoutMinutes: [1, 5, 15, 60, 180, 720],
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

export async function getAutomodConfig(guildId) {
  const file = await readConfigFile();
  const guildConfig = file.guilds[guildId] ?? cloneDefaultGuildConfig();

  return {
    ...cloneDefaultGuildConfig(),
    ...guildConfig,
    links: {
      ...cloneDefaultGuildConfig().links,
      ...guildConfig.links,
    },
    flood: {
      ...cloneDefaultGuildConfig().flood,
      ...guildConfig.flood,
    },
    joinGuard: {
      ...cloneDefaultGuildConfig().joinGuard,
      ...guildConfig.joinGuard,
    },
    escalation: {
      ...cloneDefaultGuildConfig().escalation,
      ...guildConfig.escalation,
      timeoutMinutes: [...(guildConfig.escalation?.timeoutMinutes ?? cloneDefaultGuildConfig().escalation.timeoutMinutes)],
    },
    ignoredChannelIds: [...(guildConfig.ignoredChannelIds ?? [])],
    ignoredRoleIds: [...(guildConfig.ignoredRoleIds ?? [])],
    exemptUserIds: [...(guildConfig.exemptUserIds ?? [])],
    blockedWords: [...(guildConfig.blockedWords ?? [])],
  };
}

export async function updateAutomodConfig(guildId, updater) {
  const file = await readConfigFile();
  const current = await getAutomodConfig(guildId);
  const next = updater(structuredClone(current));

  file.guilds[guildId] = next;
  await writeConfigFile(file);

  return next;
}

export function summarizeAutomodConfig(config) {
  return [
    `Automod: **${config.enabled ? 'activo' : 'desactivado'}**`,
    `Links: **${config.links.mode}**`,
    `Palabras bloqueadas: **${config.blockedWords.length}**`,
    `Flood: **${config.flood.enabled ? 'activo' : 'desactivado'}**`,
    `Join guard: **${config.joinGuard.enabled ? 'activo' : 'desactivado'}**`,
    `Escalado: **${config.escalation.enabled ? 'activo' : 'desactivado'}**`,
    `Canales ignorados: **${config.ignoredChannelIds.length}**`,
    `Roles ignorados: **${config.ignoredRoleIds.length}**`,
  ].join('\n');
}
