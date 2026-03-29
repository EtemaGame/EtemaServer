import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const locksDir = path.resolve(rootDir, 'data', 'locks');

function getLockPath(name) {
  return path.resolve(locksDir, `${name}.lock`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function readExistingPid(lockPath) {
  try {
    const raw = await readFile(lockPath, 'utf8');
    const pid = Number.parseInt(raw.split(/\s+/)[0], 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function acquireRuntimeLock(name) {
  await mkdir(locksDir, { recursive: true });
  const lockPath = getLockPath(name);

  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);

      let released = false;

      const release = async () => {
        if (released) {
          return;
        }

        released = true;
        await handle.close().catch(() => null);
        await rm(lockPath, { force: true }).catch(() => null);
      };

      const releaseAndExit = (code) => {
        void release().finally(() => {
          process.exit(code);
        });
      };

      process.once('SIGINT', () => releaseAndExit(0));
      process.once('SIGTERM', () => releaseAndExit(0));
      process.once('beforeExit', () => {
        void release();
      });
      process.once('exit', () => {
        void rm(lockPath, { force: true }).catch(() => null);
      });

      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      const existingPid = await readExistingPid(lockPath);

      if (isProcessAlive(existingPid)) {
        return null;
      }

      await rm(lockPath, { force: true }).catch(() => null);
    }
  }
}
