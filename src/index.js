import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { loadCommands } from './lib/commands.js';
import { attachAutomod } from './lib/automod.js';
import { requireEnv } from './lib/config.js';
import { acquireRuntimeLock } from './lib/runtime-lock.js';
import { attachServerLogs } from './lib/server-logs.js';
import { attachVoiceRooms, handleVoiceRoomInteraction } from './lib/voice-rooms.js';
import { attachWelcomeMessages } from './lib/welcome.js';

async function main() {
  const token = requireEnv('DISCORD_TOKEN');
  const releaseRuntimeLock = await acquireRuntimeLock('bot-runtime');

  if (!releaseRuntimeLock) {
    throw new Error(
      'Ya hay otra instancia del bot ejecutandose. Cierra los arranques extra (`start-bot`, `watch-bot` o `run-bot-24-7`) antes de abrir otro.',
    );
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.commands = new Collection();

  const commands = await loadCommands();

  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }

  client.once(Events.ClientReady, (readyClient) => {
    console.log(
      `[ready] ${readyClient.user.tag} conectado a Discord en ${readyClient.guilds.cache.size} servidor(es).`,
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() || interaction.isUserSelectMenu() || interaction.isModalSubmit()) {
      try {
        const handled = await handleVoiceRoomInteraction(interaction);

        if (handled) {
          return;
        }
      } catch (error) {
        console.error('[interaction:component]', error);

        const payload = {
          content: 'Ocurrio un error al procesar esa accion.',
          ephemeral: true,
        };

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload).catch(() => null);
          return;
        }

        await interaction.reply(payload).catch(() => null);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      await interaction.reply({
        content: 'Ese comando no esta registrado en este bot.',
        ephemeral: true,
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`[command:${interaction.commandName}]`, error);

      const payload = {
        content: 'Ocurrio un error al ejecutar el comando.',
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => null);
        return;
      }

      await interaction.reply(payload).catch(() => null);
    }
  });

  attachAutomod(client);
  attachServerLogs(client);
  attachWelcomeMessages(client);
  attachVoiceRooms(client);

  try {
    await client.login(token);
  } catch (error) {
    await releaseRuntimeLock();
    throw error;
  }
}

main().catch((error) => {
  console.error('[startup]', error.message);
  process.exitCode = 1;
});
