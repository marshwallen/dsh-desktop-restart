// Sources in lib/ are distributed directly; validate every shipped script.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

for (const directory of ['lib', 'scripts']) {
  const root = new URL(`../${directory}/`, import.meta.url)
  for (const file of readdirSync(root).filter(name => /\.(?:c?js|mjs)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, root))], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Syntax validation failed: ${directory}/${file}`)
  }
}
console.log('All shipped JavaScript passed syntax validation')
