import { mkdtemp, readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = fileURLToPath(new URL('../../admin-ui/', import.meta.url));
const output = path.join(source, 'generated');
const temporary = await mkdtemp(path.join(tmpdir(), 'godiesel-admin-'));
const write = process.argv.includes('--write');
try {
  const compile = spawnSync(process.execPath, [
    fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
    '--project', path.join(source, 'tsconfig.json'), '--outDir', temporary,
  ], { stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error('Standalone admin TypeScript compilation failed.');
  const expected = (await readdir(temporary)).sort();
  const actual = await readdir(output).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (write) await mkdir(output, { recursive: true });
  const stale = actual.filter(file => !expected.includes(file));
  for (const file of expected) {
    const emitted = await readFile(path.join(temporary, file), 'utf8');
    if (write) await writeFile(path.join(output, file), emitted);
    else {
      const checkedIn = await readFile(path.join(output, file), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (checkedIn !== emitted) stale.push(file);
    }
  }
  if (write) {
    for (const file of stale) await rm(path.join(output, file));
  } else if (stale.length) {
    throw new Error(`Stale standalone admin modules: ${stale.join(', ')}. Run npm run admin:build and commit the generated files.`);
  }
  console.log(`Standalone admin modules ${write ? 'generated' : 'current'}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
