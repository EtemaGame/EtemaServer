import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.resolve(currentDir, '..', 'commands');

export async function loadCommands() {
  const files = await readdir(commandsDir);
  const commandFiles = files.filter((file) => file.endsWith('.js'));
  const commands = [];

  for (const file of commandFiles) {
    const fileUrl = pathToFileURL(path.join(commandsDir, file)).href;
    const module = await import(fileUrl);

    if (!module.command?.data || typeof module.command.execute !== 'function') {
      throw new Error(`El archivo ${file} no exporta un comando valido.`);
    }

    commands.push(module.command);
  }

  return commands;
}
