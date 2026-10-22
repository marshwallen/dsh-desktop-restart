// 宿主：校验请求与任务状态，将重启交给分离的 helper。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MIN_ORPHAN_AGE_MS, sweepOrphanSnapshots } from './sweep.js'

export const inject = ['webServer']
const ROUTE_RESTART = '/dsh-desktop-restart/api/restart'
const ROUTE_STATUS = '/dsh-desktop-restart/api/status'
const ROUTE_SWEEP = '/dsh-desktop-restart/api/sweep'

// prefs 与旧 sweep 路由共用设置处理器。
const ROUTE_PREFS = '/dsh-desktop-restart/api/prefs'
const HELPER_PATH = fileURLToPath(new URL('./helper.cjs', import.meta.url))
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const STATE_DIR = join(DSH_HOME, 'desktop-restart')
const STATE_KEEP = 20
const SETTINGS_FILE = join(STATE_DIR, 'settings.json')
const RESTART_MARKER_FILE = join(STATE_DIR, 'last-restart.json')
const RESUME_DELAY_MS = 12_000
const RESUME_MAX_SESSIONS = 8
const SWEEP_START_DELAY_MS = 10_000

function readSettings(file = SETTINGS_FILE) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

// 临时文件写入后原子替换；失败时保留原设置。
function writeSettings(patch, file = SETTINGS_FILE) {
  const next = { ...readSettings(file), ...patch }
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${String(process.pid)}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
    return next
  } catch {
    return readSettings(file)
  }
}

const HANDOFF_DELAY_MS = 1500

// 相同 pid 表示热重载，不生成回执或恢复会话。
function restartReceipt(marker, bootPid, nowMs) {
  if (marker === null || typeof marker !== 'object') return null
  const at = typeof marker.at === 'string' ? marker.at : ''
  const atMs = Date.parse(at)
  if (!Number.isFinite(atMs)) return null
  const previousPid = Number(marker.hostPid)

  if (Number.isInteger(previousPid) && previousPid === bootPid) return null
  const sessions = Array.isArray(marker.sessions)
    ? marker.sessions.filter((id) => typeof id === 'string' && id !== '').slice(0, RESUME_MAX_SESSIONS)
    : []
  return { at, downtimeMs: Math.max(0, nowMs - atMs), sessions }
}

function busySessionsOf(agents) {
  try {
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return []
    const list = agents.list()
    if (!Array.isArray(list)) return []
    const ids = []
    for (const agent of list) {
      if (agent === null || typeof agent !== 'object') continue
      const id = typeof agent.id === 'string' ? agent.id : ''
      if (id === '') continue
      const inbox = agent.inbox
      const queued = (Array.isArray(inbox?.nextTurn) ? inbox.nextTurn.length : 0)
        + (Array.isArray(inbox?.nextStep) ? inbox.nextStep.length : 0)
      if (agent.status === 'running' || queued > 0) ids.push(id)
    }
    return ids.slice(0, RESUME_MAX_SESSIONS)
  } catch {
    return []
  }
}

// 续跑依赖按需加载，桌面环境缺少这些包时跳过续跑。
async function optionalModule(specifier) {
  try {
    const loaded = await import(specifier)
    return loaded === null || typeof loaded !== 'object' ? null : loaded
  } catch {
    return null
  }
}

const HELPER_PROBE_WAITS_MS = [300, 700]

// 交接超时后允许重试，避免 helper 失败造成永久锁定。
const HANDOFF_DEADLINE_MS = 60_000
const WAIT_POLL_MS = 5_000
const WAIT_MAX_MS = 30 * 60 * 1000
const PLUGIN_VERSION = (() => {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof parsed?.version === 'string' && parsed.version !== '' ? parsed.version : null
  } catch {
    return null
  }
})()

function platformUnsupported(platform = process.platform) {
  if (platform === 'win32') return null
  return `本插件的重启助手依赖 Windows 的 tasklist / taskkill，当前平台是 ${platform}；这一版只在 Windows 桌面版上验证过`
}

function waitingDecision(guard, sinceMs, nowMs, maxMs = WAIT_MAX_MS) {
  if (guard?.active !== true) return 'restart'
  if (Number.isFinite(sinceMs) && Number.isFinite(nowMs) && nowMs - sinceMs >= maxMs) return 'timeout'
  return 'keep'
}

// spawn 成功不代表 helper 存活，需要启动后探测。
async function helperAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  for (const wait of HELPER_PROBE_WAITS_MS) {
    await new Promise((resolve) => { setTimeout(resolve, wait) })
    try {
      process.kill(pid, 0)
      return true
    } catch {}
  }
  return false
}

function desktopTarget() {
  if (process.env.ELECTRON_RUN_AS_NODE !== '1') return null
  const exe = process.execPath
  if (typeof exe !== 'string' || exe === '') return null
  const name = basename(exe).toLowerCase()
  if (name === 'node' || name === 'node.exe') return null
  const mainPid = process.ppid
  if (!Number.isInteger(mainPid) || mainPid <= 1) return null
  return { mainPid, exe, hostPid: process.pid }
}

function isLoopbackHost(host) {
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
}

function loopbackPeer(req) {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

// 桌面壳转发可能没有 Origin，仍须校验回环地址和跨站标记。
function desktopForwarded(req) {
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return false
  if (req.headers.forwarded !== undefined
    || req.headers['x-forwarded-for'] !== undefined
    || req.headers['x-real-ip'] !== undefined) return false
  const host = req.headers.host
  if (host === undefined || !isLoopbackHost(host)) return false
  return loopbackPeer(req)
}

function trustedRequest(req) {
  if (!loopbackPeer(req)) return false
  const host = req.headers.host
  if (host === undefined) return false
  const origin = req.headers.origin
  if (origin === undefined) return desktopForwarded(req)
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

// 可选平台鉴权：透传 401/403；服务缺失或异常时使用本地信任检查。
function platformFence(ctx, req) {
  let connection
  try {
    connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  } catch (error) {
    return { available: false, verdict: null, error: String((error && error.message) || error) }
  }
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
    return { available: false, verdict: null, error: null }
  }
  let rejection
  try {
    rejection = connection.requestRejection(req)
  } catch (error) {
    return { available: true, verdict: null, error: String((error && error.message) || error) }
  }
  if (rejection === 401 || rejection === 403) return { available: true, verdict: rejection, error: null }
  return { available: true, verdict: null, error: null }
}

function describeFenceRefusal(fence, what) {
  return fence.verdict === 401
    ? `${what}需要浏览器的会话凭据，而这个请求没有带上 —— 不带 cookie 的本机进程会被挡在这里。请从 DeepSeek Harness 的页面里操作。`
    : `${what}被平台的信任栅栏拒绝：Host / Origin 或跨站标记不符。`
}

function forceRequested(url) {
  try {
    return new URL(url ?? '/', 'http://127.0.0.1').searchParams.get('force') === '1'
  } catch {
    return false
  }
}

function waitRequested(url) {
  try {
    return new URL(url ?? '/', 'http://127.0.0.1').searchParams.get('wait') === '1'
  } catch {
    return false
  }
}

function cancelWaitRequested(url) {
  try {
    return new URL(url ?? '/', 'http://127.0.0.1').searchParams.get('cancelWait') === '1'
  } catch {
    return false
  }
}

function validProfileDir(candidate) {
  if (typeof candidate !== 'string' || candidate === '') return null
  try {
    if (!statSync(candidate).isDirectory()) return null
    if (!existsSync(join(candidate, 'package.json'))) return null
    if (!existsSync(join(candidate, 'node_modules'))) return null
    return candidate
  } catch {
    return null
  }
}

function resolveProfileDir() {
  return validProfileDir(process.env.DSH_PROFILE_DIR)
    ?? validProfileDir(process.argv[3])
    ?? validProfileDir(join(DSH_HOME, 'profiles', 'desktop'))
}

// 与宿主安装器一致：Windows 检查 pid，其他平台可检查进程组。
function runAlive(run) {
  const pid = run?.pid
  if (!Number.isInteger(pid) || pid <= 0) return false
  const target = run.grouped === true && process.platform !== 'win32' ? -pid : pid
  try {
    process.kill(target, 0)
    return true
  } catch {
    return false
  }
}

// 仅活跃安装进程硬拦重启；残留记录不拦，损坏记录只警告。
function installInProgress(dir) {
  const absent = { known: true, active: false, blocked: false, running: false, pid: null, record: null }
  if (dir === null) return { ...absent, known: false }
  const record = join(dir, '.plugin-manager', 'run.json')
  if (!existsSync(record)) return absent
  let pid = null
  let grouped = false
  try {
    const parsed = JSON.parse(readFileSync(record, 'utf8'))
    if (Number.isInteger(parsed?.pid) && parsed.pid > 0) pid = parsed.pid
    grouped = parsed?.grouped === true
  } catch {}
  if (pid === null) return { known: true, active: true, blocked: false, running: false, pid: null, record }
  if (!runAlive({ pid, grouped })) {
    return { known: true, active: false, blocked: false, running: false, pid, record }
  }
  return { known: true, active: true, blocked: true, running: true, pid, record }
}

// 覆盖运行中的回合、排队消息及运行/停止中的后台任务。
function taskSnapshot(ctx) {
  try {
    const agents = typeof ctx?.get === 'function' ? ctx.get('agents') : undefined
    const jobs = typeof ctx?.get === 'function' ? ctx.get('jobs') : undefined
    if (agents === undefined || jobs === undefined) return { known: false, active: false, turns: 0, queued: 0, jobs: 0, sessions: 0 }
    if (typeof agents.list !== 'function' || typeof jobs.list !== 'function') return { known: false, active: false, turns: 0, queued: 0, jobs: 0, sessions: 0 }
    const live = agents.list()
    if (!Array.isArray(live)) return { known: false, active: false, turns: 0, queued: 0, jobs: 0, sessions: 0 }
    let turns = 0
    let queued = 0
    for (const agent of live) {
      if (agent?.status === 'running') turns += 1
      const inbox = agent?.inbox
      const nextTurn = Array.isArray(inbox?.nextTurn) ? inbox.nextTurn.length : 0
      const nextStep = Array.isArray(inbox?.nextStep) ? inbox.nextStep.length : 0
      if (nextTurn > 0 || nextStep > 0) queued += 1
    }
    let running = 0

    for (const agent of [undefined, ...live]) {
      const list = jobs.list(agent?.id)
      if (!Array.isArray(list)) continue
      for (const job of list) if (job?.status === 'running' || job?.status === 'stopping') running += 1
    }
    return { known: true, active: turns > 0 || queued > 0 || running > 0, turns, queued, jobs: running, sessions: live.length }
  } catch {
    return { known: false, active: false, turns: 0, queued: 0, jobs: 0, sessions: 0 }
  }
}

function guardReasons(tasks, installs) {
  const reasons = []
  if (tasks.known && tasks.active) {
    const parts = []
    if (tasks.turns > 0) parts.push(`${String(tasks.turns)} 项正在生成或运行工具`)
    if (tasks.queued > 0) parts.push(`${String(tasks.queued)} 个会话有排队消息`)
    if (tasks.jobs > 0) parts.push(`${String(tasks.jobs)} 个后台任务在跑`)
    reasons.push(`有任务在跑（${parts.join('、')}）`)
  }
  if (installs.active) {
    reasons.push(installs.running === true
      ? '插件正在安装或更新（记录里的进程还在跑）'
      : '插件目录上留着一条安装记录，但读不出是哪个进程（无法确认是否还在装）')
  }
  return reasons
}

function guardSnapshot(ctx, dir) {
  const tasks = taskSnapshot(ctx)
  const installs = installInProgress(dir)
  const reasons = guardReasons(tasks, installs)
  return { active: reasons.length > 0, reasons, tasks, installs }
}

// 按 handoff/log 成组保留最近记录。
function pruneState(dir) {
  try {
    const stamps = new Set()
    for (const name of readdirSync(dir)) {
      const match = /^(?:handoff|restart)-(.+)\.(?:json|log)$/u.exec(name)
      if (match !== null) stamps.add(match[1])
    }
    for (const stamp of [...stamps].sort().reverse().slice(STATE_KEEP)) {
      for (const name of [`handoff-${stamp}.json`, `restart-${stamp}.log`]) {
        try {
          unlinkSync(join(dir, name))
        } catch {}
      }
    }
  } catch {}
}

function scheduleRestart(target, port) {
  mkdirSync(STATE_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const logPath = join(STATE_DIR, `restart-${stamp}.log`)
  const handoffPath = join(STATE_DIR, `handoff-${stamp}.json`)
  writeFileSync(handoffPath, JSON.stringify({
    mainPid: target.mainPid,
    exe: target.exe,
    hostPid: target.hostPid,
    port: port ?? null,
    logPath,
    handoffPath,
    delayMs: HANDOFF_DELAY_MS,
    startedAt: new Date().toISOString(),
  }, null, 2), 'utf8')

  pruneState(STATE_DIR)

  const helper = spawn(process.execPath, [HELPER_PATH, handoffPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: dirname(HELPER_PATH),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  helper.unref()
  return {
    hostPid: target.hostPid,
    mainPid: target.mainPid,
    helperPid: helper.pid,
    logPath,
  }
}

export function apply(ctx, config = {}) {
  const target = desktopTarget()
  const enabled = config.enabled !== false
  const profileDir = resolveProfileDir()

  const platformAuth = config.platformAuth !== false
  let scheduled = false

  let waiting = null

  function clearWaiting() {
    if (waiting === null) return
    if (waiting.timer !== null) {
      try { clearTimeout(waiting.timer) } catch {           }
    }
    waiting = null
  }

  async function pollWaiting() {
    if (waiting === null) return
    const since = waiting.since
    const decision = waitingDecision(guardSnapshot(ctx, profileDir), since, Date.now())
    if (decision === 'keep') {
      waiting.timer = setTimeout(() => { void pollWaiting() }, WAIT_POLL_MS)
      waiting.timer.unref?.()
      return
    }
    clearWaiting()
    try {
      ctx.logger('dsh-desktop-restart').info(
        'deferred restart %s (armed at %s)',
        decision, new Date(since).toISOString(),
      )
    } catch {                }
    if (decision === 'restart') await scheduleOnce({ force: true })
  }

  function armWaiting() {
    clearWaiting()
    waiting = { since: Date.now(), timer: null }
    waiting.timer = setTimeout(() => { void pollWaiting() }, WAIT_POLL_MS)
    waiting.timer.unref?.()
  }

  const startedAtMs = Date.now() - Math.round(process.uptime() * 1000)
  let sweepLast = null
  let sweeping = null

  function sweepEnabled() {
    const stored = readSettings().sweep
    if (typeof stored === 'boolean') return stored
    return config.sweep === true
  }

  function resumeMode() {
    const stored = readSettings().resume
    const raw = typeof stored === 'string'
      ? stored
      : (typeof config.resume === 'string' ? config.resume : 'off')
    return raw === 'wake' || raw === 'notice' ? raw : 'off'
  }

  const sweepLog = (line) => {
    try {
      ctx.logger('dsh-desktop-restart').info('%s', line)
    } catch {}
  }

  function runSweep() {
    if (sweeping !== null) return sweeping
    sweeping = sweepOrphanSnapshots({
      tempRoot: tmpdir(),
      startedAtMs,
      minAgeMs: MIN_ORPHAN_AGE_MS,
      log: sweepLog,
    }).then((result) => {
      sweepLast = {
        at: new Date().toISOString(),
        scanned: result.scanned,
        removed: result.removed.length,
        failed: result.failed.length,
        bytes: result.bytes,
      }
      if (result.removed.length > 0 || result.failed.length > 0) {
        sweepLog(`orphan snapshot sweep: removed ${String(result.removed.length)}, failed ${String(result.failed.length)}, freed ${(result.bytes / 1048576).toFixed(1)} MB`)
      }
      return sweepLast
    }).catch((error) => {
      sweepLog(`orphan snapshot sweep failed: ${String((error && error.message) || error)}`)
      sweepLast = {
        at: new Date().toISOString(),
        scanned: 0,
        removed: 0,
        failed: 0,
        bytes: 0,
        error: String((error && error.message) || error),
      }
      return sweepLast
    }).finally(() => { sweeping = null })
    return sweeping
  }

  if (sweepEnabled()) {
    const timer = setTimeout(() => { void runSweep() }, SWEEP_START_DELAY_MS)
    timer.unref?.()
  }

  const restartMark = restartReceipt(readSettings(RESTART_MARKER_FILE), process.pid, Date.now())
  if (restartMark !== null) {
    try {
      ctx.logger('dsh-desktop-restart').info(
        'restart detected: previous boot %s, downtime ~%ds, %d interrupted session(s)',
        restartMark.at, Math.round(restartMark.downtimeMs / 1000), restartMark.sessions.length,
      )
    } catch {                }
  }

  // 只恢复重启时活跃或有排队消息的会话，每次最多 8 个。
  async function resumeInterrupted(receipt, mode) {
    const [llm, session] = await Promise.all([
      optionalModule('@deepseek-ai/dsh-llm'),
      optionalModule('@deepseek-ai/dsh-session'),
    ])
    const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    const createUserMessage = llm?.createUserMessage
    const SessionId = session?.SessionId
    if (typeof createUserMessage !== 'function' || typeof SessionId !== 'function'
      || agents === undefined || agents === null || typeof agents.get !== 'function') {
      try {
        ctx.logger('dsh-desktop-restart').info('resume skipped: official message/session API is unavailable')
      } catch {          }
      return
    }
    const seconds = Math.max(0, Math.round(receipt.downtimeMs / 1000))
    const text = `重启完成：桌面应用已于 ${receipt.at} 重启（停机约 ${String(seconds)} 秒）。如果有任务被打断，请从中断处继续。`
    let delivered = 0
    for (const id of receipt.sessions) {
      try {
        const agent = agents.get(SessionId(id))
        if (agent === undefined || agent === null) continue
        const msg = createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'plugin',
            plugin: 'dsh-desktop-restart',
            form: 'notice',
            summary: 'restart finished',
          },
        })
        if (mode === 'wake' && typeof agent.followup === 'function') agent.followup(msg)
        else if (typeof agent.inject === 'function') agent.inject(msg)
        else continue
        delivered += 1
      } catch (error) {
        try {
          ctx.logger('dsh-desktop-restart').warn(
            'resume failed for %s: %s', id, String((error && error.message) || error),
          )
        } catch {          }
      }
    }
    try {
      ctx.logger('dsh-desktop-restart').info('resume: %d/%d session(s) notified (%s)', delivered, receipt.sessions.length, mode)
    } catch {          }
  }

  const resumeWanted = resumeMode()
  if (restartMark !== null && restartMark.sessions.length > 0 && resumeWanted !== 'off') {
    const mode = resumeWanted
    const resumeTimer = setTimeout(() => { void resumeInterrupted(restartMark, mode) }, RESUME_DELAY_MS)
    resumeTimer.unref?.()
  }

  // 所有重启请求及延迟重启共用此路径。
  async function scheduleOnce(options = {}) {
    if (!enabled) {
      return { status: 403, body: { ok: false, error: '插件配置里把 enabled 设成了 false，重启功能已停用' } }
    }
    if (target === null) {
      return {
        status: 409,
        body: { ok: false, error: '当前不是 DeepSeek Harness 桌面版；本插件只负责重启桌面应用' },
      }
    }
    if (scheduled) {
      return { status: 409, body: { ok: false, error: '已经有一次重启正在准备中' } }
    }

    const unsupported = platformUnsupported()
    if (unsupported !== null) {
      return { status: 409, body: { ok: false, error: unsupported } }
    }

    if (options.wait === true) {
      const guard = guardSnapshot(ctx, profileDir)
      if (guard.active) {
        armWaiting()
        try {
          ctx.logger('dsh-desktop-restart').info('deferred restart armed: waiting for %s', guard.reasons.join('；'))
        } catch {}
        return {
          status: 202,
          body: {
            ok: true,
            waiting: true,
            since: new Date(waiting.since).toISOString(),
            pollMs: WAIT_POLL_MS,
            maxMs: WAIT_MAX_MS,
          },
        }
      }
    } else if (waiting !== null) {
      clearWaiting()
    }

    const installing = installInProgress(profileDir)
    // 安装守卫先于 force 检查，避免中断依赖写入。
    if (installing.blocked) {
      return {
        status: 409,
        body: {
          ok: false,
          blocked: true,
          guard: {
            active: true,
            reasons: guardReasons({ known: false, active: false, turns: 0, queued: 0, jobs: 0, sessions: 0 }, installing),
            blocked: true,
          },
          error: `插件正在安装或更新（进程 ${String(installing.pid)} 还在跑）。这时候重启会让它半途中断，依赖可能只装一半；等它装完再重启，通常一两分钟。`,
        },
      }
    }

    if (options.force !== true) {
      const guard = guardSnapshot(ctx, profileDir)
      if (guard.active) {
        return {
          status: 409,
          body: {
            ok: false,
            guard,
            error: `${guard.reasons.join('；')}。继续重启会打断它们（正在写的文件可能停在半路），确认要继续吗？`,
          },
        }
      }
    }

    writeSettings({
      at: new Date().toISOString(),
      hostPid: process.pid,
      sessions: busySessionsOf(ctx.get('agents')),
    }, RESTART_MARKER_FILE)

    scheduled = true

    let result
    try {
      result = scheduleRestart(target, ctx.webServer.port ?? null)
    } catch (error) {
      scheduled = false
      return { status: 500, body: { ok: false, error: String((error && error.message) || error) } }
    }

    if (!await helperAlive(result.helperPid)) {
      scheduled = false
      return {
        status: 500,
        body: { ok: false, error: '负责重启的辅助进程没能启动，这次重启没有开始；可以再试一次' },
      }
    }

    const deadline = setTimeout(() => { scheduled = false }, HANDOFF_DEADLINE_MS)
    deadline.unref?.()

    try {
      ctx.logger('dsh-desktop-restart').info(
        'restart scheduled: host pid %d, main pid %d, helper pid %s',
        result.hostPid, result.mainPid, String(result.helperPid),
      )
    } catch {}
    return { status: 202, body: { ok: true, ...result } }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_STATUS,
    handler: (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }

      if (!trustedRequest(req)) {
        send(403, { ok: false, error: '状态查询只接受来自本机页面的请求' })
        return
      }
      const guard = guardSnapshot(ctx, profileDir)

      const fence = platformAuth ? platformFence(ctx, req) : { available: false, verdict: null, error: null }
      send(200, {
        version: PLUGIN_VERSION,
        desktop: target !== null,
        enabled,
        platformAuth: { enforced: platformAuth, available: fence.available, verdict: fence.verdict, error: fence.error },

        waiting: waiting === null ? null : { since: new Date(waiting.since).toISOString(), pollMs: WAIT_POLL_MS, maxMs: WAIT_MAX_MS },

        lastRestart: restartMark === null
          ? null
          : { at: restartMark.at, downtimeMs: restartMark.downtimeMs, sessions: restartMark.sessions.length },

        guard: {
          active: guard.active,
          reasons: guard.reasons,
          blocked: guard.installs.running === true,
          tasks: {
            known: guard.tasks.known,
            active: guard.tasks.active,
            turns: guard.tasks.turns,
            queued: guard.tasks.queued,
            jobs: guard.tasks.jobs,
          },
          installs: { active: guard.installs.active, running: guard.installs.running },
        },

        sweep: { enabled: sweepEnabled(), last: sweepLast, minAgeHours: MIN_ORPHAN_AGE_MS / 3_600_000 },

        resume: resumeMode(),
      })
    },
  }), 'dsh-desktop-restart: status route')

  const settingsHandler = async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    if (!trustedRequest(req)) {
      send(403, { ok: false, error: '设置只接受来自本机页面的请求' })
      return
    }

    const fence = platformAuth ? platformFence(ctx, req) : { available: false, verdict: null, error: null }
    if (fence.verdict !== null) {
      send(fence.verdict, { ok: false, error: describeFenceRefusal(fence, '设置') })
      return
    }
    let params
    try {
      params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    } catch {
      send(400, { ok: false, error: '请求地址无法解析' })
      return
    }
    const wanted = params.get('enabled')
    if (wanted === '0' || wanted === '1') writeSettings({ sweep: wanted === '1' })
    const resume = params.get('resume')
    if (resume === 'off' || resume === 'notice' || resume === 'wake') writeSettings({ resume })
    const shouldRun = params.get('run') === '1' || wanted === '1'
    const last = shouldRun ? await runSweep() : sweepLast
    send(200, { ok: true, enabled: sweepEnabled(), resume: resumeMode(), last })
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_SWEEP,
    handler: settingsHandler,
  }), 'dsh-desktop-restart: sweep route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFS,
    handler: settingsHandler,
  }), 'dsh-desktop-restart: prefs route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_RESTART,
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      if (!trustedRequest(req)) {
        send(403, { ok: false, error: '重启只接受来自本机页面的请求' })
        return
      }

      const fence = platformAuth ? platformFence(ctx, req) : { available: false, verdict: null, error: null }
      if (fence.verdict !== null) {
        send(fence.verdict, { ok: false, error: describeFenceRefusal(fence, '重启') })
        return
      }

      if (cancelWaitRequested(req.url)) {
        const had = waiting !== null
        clearWaiting()
        send(200, { ok: true, cancelled: had })
        return
      }
      const { status, body } = await scheduleOnce({ force: forceRequested(req.url), wait: waitRequested(req.url) })
      send(status, body)
    },
  }), 'dsh-desktop-restart: restart route')

  ctx.effect(() => () => { clearWaiting() })
}

export const __test = {
  readSettings,
  writeSettings,
  taskSnapshot,
  runAlive,
  installInProgress,
  guardReasons,
  guardSnapshot,
  forceRequested,
  waitRequested,
  cancelWaitRequested,
  platformUnsupported,
  waitingDecision,
  restartReceipt,
  busySessionsOf,
  validProfileDir,
  pruneState,
  desktopTarget,
  trustedRequest,
  platformFence,
  describeFenceRefusal,
}
