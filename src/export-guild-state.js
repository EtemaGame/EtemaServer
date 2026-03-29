import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  OverwriteType,
  PermissionsBitField,
} from 'discord.js';
import { requireEnv } from './lib/config.js';

function permissionNames(bitfield) {
  return new PermissionsBitField(bitfield).toArray().sort();
}

function channelTypeName(channel) {
  return ChannelType[channel.type] ?? String(channel.type);
}

function serializeOverwrite(overwrite, guild) {
  const isRole = overwrite.type === OverwriteType.Role;
  const role = isRole ? guild.roles.cache.get(overwrite.id) : null;

  return {
    id: overwrite.id,
    type: isRole ? 'role' : 'member',
    targetName: role?.name ?? overwrite.id,
    allow: permissionNames(overwrite.allow.bitfield),
    deny: permissionNames(overwrite.deny.bitfield),
  };
}

function serializeRole(role) {
  return {
    id: role.id,
    name: role.name,
    position: role.position,
    color: role.hexColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    permissions: permissionNames(role.permissions.bitfield),
  };
}

function serializeChannel(channel, guild) {
  return {
    id: channel.id,
    name: channel.name,
    type: channelTypeName(channel),
    position: channel.rawPosition ?? channel.position ?? 0,
    parentId: channel.parentId,
    parentName: channel.parent?.name ?? null,
    nsfw: 'nsfw' in channel ? channel.nsfw : undefined,
    topic: 'topic' in channel ? channel.topic : undefined,
    rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : undefined,
    userLimit: 'userLimit' in channel ? channel.userLimit : undefined,
    bitrate: 'bitrate' in channel ? channel.bitrate : undefined,
    permissionsLocked: 'permissionsLocked' in channel ? channel.permissionsLocked : undefined,
    overwrites: channel.permissionOverwrites.cache
      .map((overwrite) => serializeOverwrite(overwrite, guild))
      .sort((a, b) => a.targetName.localeCompare(b.targetName)),
  };
}

function channelLine(channel) {
  const bits = [`${channel.type}`, `id=${channel.id}`];

  if (channel.topic) {
    bits.push(`topic="${channel.topic}"`);
  }

  if (typeof channel.userLimit === 'number' && channel.userLimit > 0) {
    bits.push(`limit=${channel.userLimit}`);
  }

  if (typeof channel.rateLimitPerUser === 'number' && channel.rateLimitPerUser > 0) {
    bits.push(`slowmode=${channel.rateLimitPerUser}s`);
  }

  if (channel.nsfw) {
    bits.push('nsfw=true');
  }

  return `- ${channel.name} [${bits.join(', ')}]`;
}

function overwriteLines(channel) {
  if (!channel.overwrites.length) {
    return [];
  }

  return channel.overwrites.map((overwrite) => {
    const allow = overwrite.allow.length ? `allow=${overwrite.allow.join('|')}` : null;
    const deny = overwrite.deny.length ? `deny=${overwrite.deny.join('|')}` : null;
    const detail = [allow, deny].filter(Boolean).join(' ');
    return `  - overwrite ${overwrite.type}:${overwrite.targetName}${detail ? ` -> ${detail}` : ''}`;
  });
}

function buildMarkdown(snapshot) {
  const lines = [
    `# Snapshot del servidor`,
    '',
    `- Generado: ${snapshot.generatedAt}`,
    `- Servidor: ${snapshot.guild.name}`,
    `- Guild ID: ${snapshot.guild.id}`,
    `- Miembros visibles: ${snapshot.guild.memberCount}`,
    `- Roles: ${snapshot.roles.length}`,
    `- Canales: ${snapshot.channels.length}`,
    '',
    '## Roles',
    '',
  ];

  for (const role of snapshot.roles) {
    lines.push(
      `- ${role.name} [pos=${role.position}, color=${role.color}, hoist=${role.hoist}, mentionable=${role.mentionable}, managed=${role.managed}]`,
    );
    if (role.permissions.length) {
      lines.push(`  - perms: ${role.permissions.join(', ')}`);
    }
  }

  lines.push('', '## Canales', '');

  const categories = snapshot.channels.filter((channel) => channel.type === 'GuildCategory');
  const grouped = new Map();

  for (const category of categories) {
    grouped.set(category.id, []);
  }

  const rootChannels = [];

  for (const channel of snapshot.channels.filter((channel) => channel.type !== 'GuildCategory')) {
    if (channel.parentId && grouped.has(channel.parentId)) {
      grouped.get(channel.parentId).push(channel);
    } else {
      rootChannels.push(channel);
    }
  }

  for (const category of categories) {
    lines.push(`- ${category.name} [categoria, id=${category.id}]`);

    const children = grouped
      .get(category.id)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

    for (const child of children) {
      lines.push(`  ${channelLine(child)}`);
      lines.push(...overwriteLines(child).map((line) => `  ${line}`));
    }
  }

  if (rootChannels.length) {
    lines.push('', '## Sin categoria', '');

    for (const channel of rootChannels.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
      lines.push(channelLine(channel));
      lines.push(...overwriteLines(channel));
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const token = requireEnv('DISCORD_TOKEN');
  const guildId = requireEnv('GUILD_ID');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout esperando la conexion del cliente.'));
    }, 20000);

    client.once(Events.ClientReady, () => {
      clearTimeout(timer);
      resolve();
    });
  });

  await client.login(token);
  await ready;

  const guild = await client.guilds.fetch(guildId);
  await guild.fetch();
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = guild.roles.cache
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
    .map((role) => serializeRole(role));

  const channels = guild.channels.cache
    .filter((channel) => !channel.isThread())
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || a.name.localeCompare(b.name))
    .map((channel) => serializeChannel(channel, guild));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    guild: {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      ownerId: guild.ownerId,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
    },
    roles,
    channels,
  };

  const snapshotDir = path.resolve('snapshots');
  await mkdir(snapshotDir, { recursive: true });

  const timestamp = snapshot.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(snapshotDir, `guild-${timestamp}.json`);
  const mdPath = path.join(snapshotDir, `guild-${timestamp}.md`);
  const latestJsonPath = path.join(snapshotDir, 'guild-latest.json');
  const latestMdPath = path.join(snapshotDir, 'guild-latest.md');

  await writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, buildMarkdown(snapshot), 'utf8');
  await writeFile(latestJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await writeFile(latestMdPath, buildMarkdown(snapshot), 'utf8');

  console.log(`[snapshot] JSON: ${jsonPath}`);
  console.log(`[snapshot] MD: ${mdPath}`);
  console.log(`[snapshot] latest files updated in ${snapshotDir}`);

  client.destroy();
}

main().catch((error) => {
  console.error('[snapshot]', error.message);
  process.exitCode = 1;
});
