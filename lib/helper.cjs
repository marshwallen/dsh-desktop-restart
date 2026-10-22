// 分离的 Windows 重启助手：结束主进程、等待端口释放，再拉起应用。
'use strict'

const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const MAIN_EXIT_TIMEOUT_MS = 15000
const PORT_FREE_TIMEOUT_MS = 30000
const DEFAULT_DELAY_MS = 1500
const DEFAULT_RELAUNCH_ATTEMPTS = 3
const DEFAULT_RELAUNCH_VERIFY_MS = 2500
const RELAUNCH_RETRY_GAP_MS = 1500
const PORT_RELISTEN_TIMEOUT_MS = 20000
const PROCESS_QUERY_TIMEOUT_MS = 8000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 仅识别回环或通配地址上的 TCP LISTENING；无法解析时返回 null。
function parseNetstatListeners(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const rows = []
  for (const line of text.split('\n')) {
    const match = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/u.exec(line)
    if (match === null) continue
    if (!/^(?:127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|\[::\])$/u.test(match[1])) continue
    const port = Number(match[2])
    const pid = Number(match[3])
    if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(pid) || pid <= 0) continue
    rows.push({ port, pid })
  }
  return rows
}

function normalizePath(value) {
  return String(value ?? '').replace(/\//gu, '\\').replace(/\\+$/u, '').toLowerCase()
}

function tokenizeCommandLine(text) {
  const tokens = []
  let current = ''
  let started = false
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\' && text[index + 1] === '"') {
      current += '"'
      started = true
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      started = true
      continue
    }
    if (!inQuotes && (char === ' ' || char === '\t')) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

// 移除 Electron Node 模式和旧会话环境，保留安装身份。
function launchEnvFrom(source) {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()

    if (upper === 'ELECTRON_RUN_AS_NODE' || upper === 'DSH_DESKTOP_NODE_EXECUTABLE') delete env[key]

    if (upper === 'DSH_SESSION_ID' || upper === 'DSH_WEB_URL' || upper === 'DSH_SHELL') delete env[key]
  }
  return env
}

// 仅接受主进程启动参数；无法可靠解析时回退为无参数启动。
function relaunchArgsFrom(commandLine, exe) {
  if (typeof commandLine !== 'string' || commandLine.trim() === '') return null

  if (commandLine.includes('\\"')) return null
  const tokens = tokenizeCommandLine(commandLine)
  if (tokens.length === 0) return null
  if (normalizePath(tokens[0]) !== normalizePath(exe)) return null
  const args = tokens.slice(1)

  for (const arg of args) {
    if (/^--type=/u.test(arg) || arg === '--expose-internals') return null
  }
  return args
}

function leftoverPids(processes, exe, skip = []) {
  const wanted = normalizePath(exe)
  const skipSet = new Set((Array.isArray(skip) ? skip : []).filter((pid) => Number.isInteger(pid) && pid > 0))
  const pids = []
  for (const entry of Array.isArray(processes) ? processes : []) {
    if (!Number.isInteger(entry?.pid) || entry.pid <= 0) continue
    if (typeof entry.path !== 'string' || entry.path === '') continue
    if (normalizePath(entry.path) !== wanted) continue
    if (skipSet.has(entry.pid)) continue
    pids.push(entry.pid)
  }
  return pids
}

function queryApplicationProcesses(exeName) {
  const safeName = String(exeName).replace(/'/gu, "''")
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
    `Get-CimInstance Win32_Process -Filter "Name='${safeName}'" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
  ].join('; ')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  let out = ''
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    try {
      out = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        encoding: 'utf8',
        timeout: PROCESS_QUERY_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
      break
    } catch (error) {
      out = ''
      if (error && error.code !== 'ENOENT') return null
    }
  }
  const text = out.trim()
  if (text === '') return []
  try {
    const parsed = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.map((entry) => ({
      pid: Number(entry?.ProcessId),
      path: typeof entry?.ExecutablePath === 'string' ? entry.ExecutablePath : null,
      commandLine: typeof entry?.CommandLine === 'string' ? entry.CommandLine : null,
    })).filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0)
  } catch {
    return null
  }
}

function alertUser(text) {
  const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(text)}, 'DeepSeek Harness') | Out-Null`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    try {
      const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return true
    } catch {}
  }
  return false
}

async function performRestart(handoff, note) {
  const mainPid = Number(handoff.mainPid)
  const exe = String(handoff.exe ?? '')
  const hostPid = Number(handoff.hostPid)
  const port = Number(handoff.port)
  const delayMs = Number(handoff.delayMs) > 0 ? Number(handoff.delayMs) : DEFAULT_DELAY_MS
  const attempts = Number(handoff.relaunchAttempts) > 0 ? Number(handoff.relaunchAttempts) : DEFAULT_RELAUNCH_ATTEMPTS
  const verifyMs = Number(handoff.relaunchVerifyMs) > 0 ? Number(handoff.relaunchVerifyMs) : DEFAULT_RELAUNCH_VERIFY_MS

  const mainExitTimeoutMs = Number(handoff.mainExitTimeoutMs) > 0 ? Number(handoff.mainExitTimeoutMs) : MAIN_EXIT_TIMEOUT_MS
  const portFreeTimeoutMs = Number(handoff.portFreeTimeoutMs) > 0 ? Number(handoff.portFreeTimeoutMs) : PORT_FREE_TIMEOUT_MS
  const portRelistenTimeoutMs = Number(handoff.portRelistenTimeoutMs) > 0 ? Number(handoff.portRelistenTimeoutMs) : PORT_RELISTEN_TIMEOUT_MS
  const alertOnFailure = handoff.alertOnFailure !== false

  const alive = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  // 用连接探测端口，避免绑定占用新实例需要的端口。
  const listening = (p) => new Promise((resolve) => {
    let settled = false
    const probe = net.connect({ host: '127.0.0.1', port: p })
    const finish = (value) => {
      if (settled) return
      settled = true
      probe.destroy()
      resolve(value)
    }
    probe.on('connect', () => finish(true))
    probe.on('error', () => finish(false))
    probe.setTimeout(500, () => finish(false))
  })

  // 不使用 /T，让 host 在 IPC 断开后优雅关闭并保存会话。
  const killPid = (pid) => {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
      return true
    } catch {
      return false
    }
  }

  const tasklist = (args) => {
    try {
      const out = execFileSync('tasklist', args, { encoding: 'utf8', windowsHide: true })
      return [...out.matchAll(/"([^"]*)","(\d+)"/gu)]
        .map((match) => ({ image: match[1], pid: Number(match[2]) }))
        .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0)
    } catch {
      return null
    }
  }

  // known:false 表示查询失败；known:true 且 image:null 才表示进程不存在。
  const imageNameOf = (pid) => {
    const rows = tasklist(['/FI', `PID eq ${String(pid)}`, '/FO', 'CSV', '/NH'])
    if (rows === null) return { known: false, image: null }
    const found = rows.find((entry) => entry.pid === pid)
    return { known: true, image: found === undefined ? null : found.image }
  }

  const applicationPids = () => {
    if (exe === '') return []
    const rows = tasklist(['/FI', `IMAGENAME eq ${path.basename(exe)}`, '/FO', 'CSV', '/NH'])
    return rows === null ? null : rows.map((entry) => entry.pid)
  }

  const listListening = () => {
    try {
      const out = execFileSync('netstat', ['-ano'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: PROCESS_QUERY_TIMEOUT_MS,
      })
      return parseNetstatListeners(out)
    } catch {
      return null
    }
  }

  note(`helper started: helper=${process.pid} host=${hostPid} main=${mainPid} port=${port} exe=${exe}`)

  if (!Number.isInteger(mainPid) || mainPid <= 1) {
    note('refusing: the handoff carries no usable main process id')
    return
  }
  if (exe === '') {
    note('refusing: the handoff carries no application executable')
    return
  }

  await sleep(delayMs)

  // 主进程退出前读取启动参数与可执行路径。
  const processes = queryApplicationProcesses(path.basename(exe))
  const mainEntry = Array.isArray(processes) ? processes.find((entry) => entry.pid === mainPid) ?? null : null
  const relaunchArgs = relaunchArgsFrom(mainEntry?.commandLine, exe)
  note(relaunchArgs === null
    ? 'launch arguments unavailable; relaunching with no arguments'
    : `preserving ${String(relaunchArgs.length)} launch argument(s): ${JSON.stringify(relaunchArgs)}`)

  const expected = path.basename(exe).toLowerCase()
  const probe = imageNameOf(mainPid)
  if (probe.known && probe.image !== null && probe.image.toLowerCase() !== expected) {
    note(`refusing: pid ${mainPid} is "${probe.image}", not "${expected}"`)
    return
  }
  if (!probe.known) {
    note(`could not read the process table; ending pid ${mainPid} without an image-name check`)
    note(killPid(mainPid) ? `taskkill /PID ${mainPid} /F ok` : `taskkill /PID ${mainPid} /F reported an error`)
  } else if (probe.image === null) {
    note(`main process ${mainPid} is already gone; skipping the kill`)
  } else {
    note(`ending the Electron main process ${mainPid} ("${probe.image}") without /T, so the host can close gracefully`)
    note(killPid(mainPid) ? `taskkill /PID ${mainPid} /F ok` : `taskkill /PID ${mainPid} /F reported an error`)
  }

  const goneBy = Date.now() + mainExitTimeoutMs
  while (Date.now() < goneBy && alive(mainPid)) await sleep(200)
  note(alive(mainPid) ? `main process still alive after ${mainExitTimeoutMs}ms` : 'main process exited')

  if (Number.isInteger(port) && port > 0) {
    const freeBy = Date.now() + portFreeTimeoutMs
    while (Date.now() < freeBy && await listening(port)) await sleep(300)
    if (await listening(port)) {
      note(`port ${port} is still held; terminating leftover application processes`)

      // 清理优先按完整路径匹配，并排除 helper、主进程和 host。
      const skip = [process.pid, mainPid, hostPid]
      const own = Array.isArray(processes) ? leftoverPids(processes, exe, skip) : null
      let candidates
      if (own !== null && own.length > 0) {
        candidates = own
      } else {
        const byImage = applicationPids()
        if (byImage === null) {
          note('the process table is unavailable; no leftover process could be identified')
          candidates = []
        } else {
          note(own === null ? 'process paths unavailable; falling back to image-name matching' : 'no matching executable path; falling back to image-name matching')
          candidates = byImage.filter((pid) => !skip.includes(pid))
        }
      }
      for (const pid of candidates) {
        note(`killing leftover pid ${pid}`)
        killPid(pid)
      }
      await sleep(1500)

      // 仅在端口仍被占用时最后结束 host；此时会话日志可能不完整。
      if (Number.isInteger(hostPid) && hostPid > 1 && hostPid !== process.pid && hostPid !== mainPid
        && await listening(port) && alive(hostPid)) {
        note(`the host (pid ${hostPid}) still holds port ${port}; ending it as a last resort — its session logs may be incomplete`)
        note(killPid(hostPid) ? `taskkill /PID ${hostPid} /F ok` : `taskkill /PID ${hostPid} /F reported an error`)
        await sleep(1500)
      }
    } else {
      note(`port ${port} released`)
    }
  }

  await sleep(800)

  const env = launchEnvFrom(process.env)

  let childPid = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      note(`relaunch attempt ${attempt}/${attempts} in ${RELAUNCH_RETRY_GAP_MS}ms`)
      await sleep(RELAUNCH_RETRY_GAP_MS)
    }
    let spawned = null
    try {
      const child = spawn(exe, relaunchArgs ?? [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: path.dirname(exe),
        env,
      })
      child.on('error', (error) => note(`relaunch failed: ${String((error && error.message) || error)}`))
      spawned = child.pid
      child.unref()
      note(`relaunched "${exe}" as pid ${String(spawned)}${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
    } catch (error) {
      note(`relaunch threw: ${String((error && error.stack) || error)}`)
      continue
    }

    // 确认新实例存活后才认定拉起成功，失败则重试。
    await sleep(verifyMs)
    if (Number.isInteger(spawned) && alive(spawned)) {
      note(`relaunched process (pid ${String(spawned)}) is still alive after ${verifyMs}ms`)
      childPid = spawned
      break
    }
    note(`the relaunched process (pid ${String(spawned)}) is already gone — attempt ${attempt} did not take`)
  }

  if (childPid === null) {
    note(`the restart did not take after ${attempts} attempt(s); the application is not running`)
    if (alertOnFailure) {
      note(alertUser(`重启失败：应用没能自动打开。\n\n请手动启动 DeepSeek Harness（日志：${String(handoff.logPath ?? '')}）。`)
        ? 'failure notice dispatched to the user'
        : 'could not dispatch the failure notice')
    }
    return
  }

  // 新实例可能换端口，按应用进程的回环监听判断就绪。
  const quietPids = [process.pid, mainPid, hostPid]
  const listenBy = Date.now() + portRelistenTimeoutMs
  let readyPort = null
  let tableReadable = false
  while (Date.now() < listenBy) {
    const entries = listListening()
    if (entries !== null) {
      tableReadable = true
      const sameImage = applicationPids()
      if (sameImage !== null) {
        const candidates = entries.filter(
          (entry) => sameImage.includes(entry.pid) && !quietPids.includes(entry.pid),
        )
        if (candidates.length > 0) {
          readyPort = candidates[0].port
          break
        }
      }
    }

    await sleep(500)
  }
  if (readyPort !== null) {
    note(`the new instance is listening on port ${readyPort} — restart complete`)
  } else if (tableReadable) {
    note(`the new instance is alive but no listening port belongs to "${expected}" within ${portRelistenTimeoutMs}ms`)
  } else {
    note('the new instance is alive; the listening port table could not be read, so readiness is unknown')
  }
}

async function start() {
  const handoffPath = process.argv[2]
  if (typeof handoffPath !== 'string' || handoffPath === '') {
    process.exit(1)
  }

  let handoff
  try {
    handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'))
  } catch {
    process.exit(1)
  }

  const logPath = String(handoff.logPath ?? '')

  const note = (line) => {
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
    } catch {}
  }

  try {
    await performRestart(handoff, note)
  } catch (error) {
    note(`helper failed: ${String((error && error.stack) || error)}`)
  }
}

if (require.main === module) {
  start().catch(() => { process.exitCode = 0 })
}

module.exports = {
  normalizePath,
  tokenizeCommandLine,
  relaunchArgsFrom,
  launchEnvFrom,
  leftoverPids,
  parseNetstatListeners,
  queryApplicationProcesses,
  performRestart,
}
