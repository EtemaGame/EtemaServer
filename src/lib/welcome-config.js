import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const configPath = path.resolve(rootDir, 'data', 'welcome-config.json');

export const DEFAULT_WELCOME_TEMPLATE = 'Hola {user}, bienvenido/a a **{server}**. Ya somos **{memberCount}** miembro(s).';

function parseBooleanEnv(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

export function getDefaultWelcomeConfig() {
  return {
    enabled: parseBooleanEnv(process.env.WELCOME_ENABLED, false),
    channelId: process.env.WELCOME_CHANNEL_ID?.trim() || null,
    messageTemplate: process.env.WELCOME_MESSAGE_TEMPLATE?.trim() || DEFAULT_WELCOME_TEMPLATE,
  };
}

function cloneDefaultGuildConfig() {
  return JSON.parse(JSON.stringify(getDefaultWelcomeConfig()));
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

export async function getWelcomeConfig(guildId) {
  const file = await readConfigFile();
  const guildConfig = file.guilds[guildId] ?? cloneDefaultGuildConfig();

  return {
    ...cloneDefaultGuildConfig(),
    ...guildConfig,
  };
}

export async function updateWelcomeConfig(guildId, updater) {
  const file = await readConfigFile();
  const current = await getWelcomeConfig(guildId);
  const next = updater(structuredClone(current));

  file.guilds[guildId] = next;
  await writeConfigFile(file);

  return next;
}
