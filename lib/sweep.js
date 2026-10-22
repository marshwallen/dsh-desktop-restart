// 清理宿主启动前创建、此后未写入且至少 24 小时的快照目录。
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const SNAPSHOT_PREFIX = 'dsh-workspace-changes-'
export const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

// 多实例中长期闲置的会话目录仍可能被误判；清理仅删除快照副本。
export function orphanSnapshots(entries, startedAtMs, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const minAgeMs = Number.isFinite(options.minAgeMs) ? options.minAgeMs : MIN_ORPHAN_AGE_MS
  if (!Number.isFinite(startedAtMs)) return []
  const picked = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry?.name !== 'string' || !entry.name.startsWith(SNAPSHOT_PREFIX)) continue
    if (typeof entry.isDirectory === 'function' && entry.isDirectory() === false) continue
    const created = Number(entry.createdAtMs)
    const modified = Number(entry.modifiedAtMs)
    if (!Number.isFinite(created) || !Number.isFinite(modified)) continue

    if (created >= startedAtMs) continue
    if (modified >= startedAtMs) continue
    if (now - created < minAgeMs) continue
    picked.push(entry.name)
  }
  return picked
}

async function treeSize(dir) {
  let bytes = 0
  let files = 0
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() !== true) continue
      files += 1
      try {
        bytes += (await stat(join(entry.parentPath ?? dir, entry.name))).size
      } catch {}
    }
  } catch {
    return { bytes: 0, files: 0 }
  }
  return { bytes, files }
}

export async function sweepOrphanSnapshots(options = {}) {
  const tempRoot = typeof options.tempRoot === 'string' ? options.tempRoot : ''
  const startedAtMs = Number(options.startedAtMs)
  const log = typeof options.log === 'function' ? options.log : () => {}
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const statOf = typeof options.statOf === 'function' ? options.statOf : stat
  const result = { scanned: 0, removed: [], failed: [], bytes: 0, files: 0 }
  if (tempRoot === '' || !Number.isFinite(startedAtMs)) return result

  let dirents
  try {
    dirents = await readdir(tempRoot, { withFileTypes: true })
  } catch {
    return result
  }

  const candidates = []
  for (const dirent of dirents) {
    if (!dirent.name.startsWith(SNAPSHOT_PREFIX)) continue
    result.scanned += 1
    let info
    try {
      info = await statOf(join(tempRoot, dirent.name))
    } catch {
      continue
    }

    // 缺少创建时间时退回 ctime。
    const created = Number.isFinite(info.birthtimeMs) && info.birthtimeMs > 0 ? info.birthtimeMs : info.ctimeMs
    candidates.push({
      name: dirent.name,

      // 包装调用以保留 Stats.isDirectory 的 this。
      isDirectory: typeof info.isDirectory === 'function' ? () => info.isDirectory() : () => true,
      createdAtMs: created,
      modifiedAtMs: info.mtimeMs,
    })
  }

  const doomed = orphanSnapshots(candidates, startedAtMs, { now, minAgeMs: options.minAgeMs })
  for (const name of doomed) {
    const target = join(tempRoot, name)
    const size = await treeSize(target)
    try {
      await rm(target, { recursive: true, force: true })
      result.removed.push(name)
      result.bytes += size.bytes
      result.files += size.files
      log(`removed orphan snapshot ${name} (${String(size.files)} file(s), ${(size.bytes / 1048576).toFixed(1)} MB)`)
    } catch (error) {
      result.failed.push({ name, error: String((error && error.code) || (error && error.message) || error) })
      log(`could not remove orphan snapshot ${name}: ${String((error && error.message) || error)}`)
    }
  }
  return result
}
