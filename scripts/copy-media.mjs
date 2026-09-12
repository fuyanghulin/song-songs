import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')

for (const directory of ['songs', 'lyrics']) {
  const source = resolve(projectRoot, directory)
  const destination = resolve(projectRoot, 'dist', directory)
  await mkdir(destination, { recursive: true })
  await cp(source, destination, { recursive: true, force: true })
}

console.log('Copied songs/ and lyrics/ into dist/.')
