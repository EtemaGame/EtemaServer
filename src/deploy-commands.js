import { REST, Routes } from 'discord.js';
import { loadCommands } from './lib/commands.js';
import { requireEnv } from './lib/config.js';

async function main() {
  const token = requireEnv('DISCORD_TOKEN');
  const clientId = requireEnv('CLIENT_ID');
  const guildId = requireEnv('GUILD_ID');
  const commands = await loadCommands();
  const payload = commands.map((command) => command.data.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);

  console.log(`[deploy] Registrando ${payload.length} comando(s) en el servidor ${guildId}...`);

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: payload,
  });

  console.log('[deploy] Comandos registrados correctamente.');
}

main().catch((error) => {
  console.error('[deploy]', error.message);
  process.exitCode = 1;
});
