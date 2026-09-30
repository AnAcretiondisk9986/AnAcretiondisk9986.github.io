import { randomBytes, createHash } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Replace a file atomically by writing a unique sibling and renaming it into place. */
export async function atomicWriteFile(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}
