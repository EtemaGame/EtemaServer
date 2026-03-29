import { loadCommands } from './lib/commands.js';

async function main() {
  const commands = await loadCommands();
  const names = commands.map((command) => command.data.name).join(', ');

  console.log(`[validate] Comandos cargados: ${names}`);
}

main().catch((error) => {
  console.error('[validate]', error.message);
  process.exitCode = 1;
});
