// Exercise the actual npm archive in an isolated, offline consumer.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const npm = process.env.npm_execpath
if (!npm) throw new Error('Run via npm run smoke:archive')
const source = fileURLToPath(new URL('../', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'desktop restart 中文 '))
const consumer = join(root, 'consumer with spaces')
// npm 11 forwards the local script policy as a CLI-only environment option.
// Preserve it in the disposable consumer's manifest for nested installation.
const env = { ...process.env }
const allowScripts = {}
for (const key of Object.keys(env)) {
  if (key.toLowerCase() !== 'npm_config_allow_scripts') continue
  for (const entry of env[key].split(',').map(value => value.trim()).filter(Boolean)) allowScripts[entry] = true
  delete env[key]
}
const runNode = (args, cwd, stdio = 'inherit') => {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 60000, stdio })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Node command failed with exit ${result.status}: ${args[0]}`)
  return result.stdout
}
const runNpm = (args, cwd) => runNode([npm, ...args], cwd, ['ignore', 'pipe', 'inherit'])

try {
  const [packed] = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', root], source))
  for (const path of ['lib/index.js', 'lib/client.js', 'lib/helper.cjs', 'lib/sweep.js',
    'scripts/build.mjs', 'scripts/smoke.mjs', 'scripts/smoke-archive.mjs',
    'package.json', 'cordis.patch.yml', 'README.md', 'README.en.md', 'LICENSE']) {
    assert.ok(packed.files.some(file => file.path === path), `Archive is missing ${path}`)
  }
  mkdirSync(consumer)
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', allowScripts }))
  runNpm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(root, packed.filename)], consumer)
  const installed = join(consumer, 'node_modules', packed.name)
  runNode([join(installed, 'scripts/build.mjs')], consumer)
  runNode([join(installed, 'scripts/smoke.mjs')], consumer)
  console.log(`Archive consumer passed on ${process.platform} (${process.version})`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
