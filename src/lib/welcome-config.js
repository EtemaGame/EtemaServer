import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const configPath = path.resolve(rootDir, 'data', 'welcome-config.json');

export const DEFAULT_WELCOME_TEMPLATE = 'Hola {user}, bienvenido/a a **{server}**. Ya somos **{memberCount}** miembro(s).';

const DEFAULT_GUILD_CONFIG = {
  enabled: false,
  channelId: null,
  messageTemplate: DEFAULT_WELCOME_TEMPLATE,
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
