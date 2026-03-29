# Bot de Discord para Etema

Bot de Discord con `discord.js` para administrar el servidor Etema.

## Requisitos

- Node.js 18 o superior.
- Un bot creado en Discord Developer Portal.
- Estas variables de entorno:
  - `DISCORD_TOKEN`
  - `CLIENT_ID`
  - `GUILD_ID`
  - `BOT_OWNER_ID` opcional, para darle a una cuenta override extra sobre las restricciones normales

## Preparar el entorno local

1. Copia `.env.example` a `.env`.
2. Rellena tus valores reales.
3. Instala dependencias con `npm install`.
4. Si no tienes `npm` en el PATH de Windows, usa `npm-local.cmd install`.
5. Registra comandos con `npm run deploy` o `deploy-commands.cmd`.
6. Inicia el bot con `npm start` o `start-bot.cmd`.

Variables opcionales para una bienvenida persistente en Railway:

- `WELCOME_ENABLED=true`
- `WELCOME_CHANNEL_ID=` id del canal de bienvenida
- `WELCOME_MESSAGE_TEMPLATE=` usa `{user}`, `{server}` y `{memberCount}`

## Atajos para Windows

Los `.cmd` del proyecto siguen funcionando para un flujo local comodo:

- `npm-local.cmd`
- `node-local.cmd`
- `start-bot.cmd`
- `watch-bot.cmd`
- `deploy-commands.cmd`
- `validate.cmd`
- `export-guild-state.cmd`
- `run-bot-24-7.cmd`

Si existe `Tools\node-v24.14.1-win-x64`, esos atajos usaran ese Node portable.
Si no existe, intentaran usar `node` y `npm` instalados en el sistema.

## Validar antes de subir

- `npm run validate`
- `git status`

## Que subir a GitHub

Sube el codigo fuente y los archivos de configuracion del proyecto, por ejemplo:

- `src/`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `.env.example`
- `README.md`
- scripts `.cmd` si quieres seguir con soporte Windows

## Que NO subir

Estos archivos o carpetas deben quedarse fuera del repo:

- `.env`
- `node_modules/`
- `logs/`
- `data/`
- `snapshots/`
- `reports/`
- `Tools/`

## Desplegar en Railway

1. Sube el proyecto a un repositorio privado de GitHub.
2. En Railway, crea un proyecto nuevo desde ese repo.
3. Agrega estas variables en Railway:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
   - `BOT_OWNER_ID` solo si quieres una cuenta con override extra
   - `WELCOME_ENABLED`, `WELCOME_CHANNEL_ID` y `WELCOME_MESSAGE_TEMPLATE` si quieres fijar la bienvenida por variables y que sobreviva redeploys
4. Deja que Railway use el comando por defecto de Node. Este proyecto ya expone `npm start`.

No hace falta exponer un puerto HTTP: este servicio corre como bot de Discord.

## Modo 24/7 en Windows

### Opcion rapida

Ejecuta `run-bot-24-7.cmd`.

- Si el bot se cae, vuelve a arrancar solo.
- Los logs quedan en `logs\bot.log` y `logs\runner.log`.

### Opcion con tarea programada

Ejecuta `install-24-7-task.cmd`.

- Crea una tarea programada llamada `EtemaServerBot24x7`.
- Se inicia automaticamente al abrir sesion.
- Para quitarla, usa `remove-24-7-task.cmd`.

## Comandos incluidos

- `/ping`
- `/server`
- `/limpiar`
- `/rol`
- `/canal`
- `/moderar`
- `/diagnostico`
- `/automod`
- `/bienvenida`
- `/mods`
- `/room`
