import { mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const locksDir = path.resolve(rootDir, 'data', 'locks');

function getLockPath(name) {
  return path.resolve(locksDir, `${name}.lock`);
}

async function isStale(lockPath, staleMs) {
  try {
    const details = await stat(lockPath);
    return Date.now() - details.mtimeMs > staleMs;
  } catch {
    return false;
  }
}

async function acquireLock(name, staleMs) {
  await mkdir(locksDir, { recursive: true });
  const lockPath = getLockPath(name);

  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      return { handle, lockPath };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      if (await isStale(lockPath, staleMs)) {
        await rm(lockPath, { force: true }).catch(() => null);
        continue;
      }

      return null;
    }
  }
}

async function releaseLock(lock) {
  if (!lock) {
    return;
  }

  await lock.handle.close().catch(() => null);
  await rm(lock.lockPath, { force: true }).catch(() => null);
}

export async function withLeaseLock(name, fn, options = {}) {
  const staleMs = options.staleMs ?? 30_000;
  const lock = await acquireLock(name, staleMs);

  if (!lock) {
    return {
      acquired: false,
      value: null,
    };
  }

  try {
    return {
      acquired: true,
      value: await fn(),
    };
  } finally {
    await releaseLock(lock);
  }
}
