/**
 * dsh-sidebar-editor - Host half.
 *
 * Local JSON routes behind the right Sidebar's editor and file manager:
 *
 *   POST /api/sidebar-editor/read    { sessionId, path }                     -> text + version
 *   POST /api/sidebar-editor/write   { sessionId, path, content, version? }  -> new version
 *   POST /api/sidebar-editor/list    { sessionId, path }                     -> directory entries
 *   POST /api/sidebar-editor/create  { sessionId, path }                     -> new empty file
 *   POST /api/sidebar-editor/mkdir   { sessionId, path }                     -> new directory
 *   POST /api/sidebar-editor/rename  { sessionId, from, to }                 -> renamed entry
 *   POST /api/sidebar-editor/delete  { sessionId, path }                     -> removed entry
 *
 * Reads and writes go through `ctx.fs`, so they keep the backend's read
 * authority and the session's sandbox policy (the write passes the resolved
 * policy as the per-call fence). The filesystem seam has no mkdir, rename, or
 * delete, so those three use `node:fs/promises`; each one first applies the
 * same session policy itself: `read-only` refuses every mutation,
 * `workspace-write` admits only targets that canonicalize under the session
 * workspace or a platform temp root, and `danger-full-access` stays unfenced.
 * Directory listing stays inside the session workspace, like the shipped
 * Files tab.
 *
 * Request trust mirrors the other local plugin routes: the listener is
 * loopback only, cross-site POSTs are blocked by the required custom header
 * (a custom header forces a CORS preflight this server never answers), and a
 * browser `Origin`, when present, must name this listener.
 */

import { execFile } from 'node:child_process'
import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const name = 'sidebar-editor'
export const inject = ['webServer', 'fs', 'sessions', 'sandboxPolicy']

const PLUGIN_ID = 'sidebar-editor'
/**
 * Accepted values of the CSRF guard header. The browser half sends the short
 * row token; the package-qualified spelling stays accepted so a Client bundle
 * and a Host row reloaded at different moments cannot lock each other out.
 */
const PLUGIN_TOKENS = new Set(['sidebar-editor', 'dsh-sidebar-editor'])
const PLUGIN_HEADER = 'x-dsh-plugin'
const PREFIX = '/api/sidebar-editor'
/** UTF-8 text cap the editor will load in one piece. */
const MAX_READ_BYTES = 2 * 1024 * 1024
/** UTF-8 cap for one save. */
const MAX_WRITE_BYTES = 4 * 1024 * 1024
/** Transport cap for one JSON request body. */
const MAX_BODY_BYTES = 8 * 1024 * 1024
/** Directory listing cap; the remainder is reported as truncated. */
const MAX_LIST_ENTRIES = 4000
const SESSION_ID_RE = /^[A-Za-z0-9._:@~-]{1,200}$/
const WINDOWS = process.platform === 'win32'

function httpError(statusCode, code, message, details) {
  return Object.assign(new Error(message), { statusCode, code, details })
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_BODY_BYTES) throw httpError(413, 'BODY_TOO_LARGE', '请求体过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw httpError(400, 'INVALID_BODY', '请求体不是合法 JSON')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw httpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象')
  }
  return data
}

/** Map a provider failure onto a stable HTTP status and code for the Client. */
function mapFsError(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const mode = typeof error?.details?.mode === 'string' ? error.details.mode : undefined
  switch (code) {
    case 'FS_STALE_VERSION':
      return httpError(409, 'STALE_VERSION', '文件已在其他位置被修改，请重新加载后再保存。')
    case 'FS_NOT_FOUND':
      return httpError(404, 'NOT_FOUND', '文件不存在，可能已被移动或删除。')
    case 'FS_EXISTS':
      return httpError(409, 'EXISTS', '同名文件或文件夹已存在。')
    case 'FS_NOT_TEXT':
      return httpError(415, 'NOT_TEXT', '这不是可以按文本编辑的文件（二进制或非 UTF-8 编码）。')
    case 'FS_TOO_LARGE':
      return httpError(413, 'TOO_LARGE', '文件太大，超过了侧栏编辑器的上限。')
    case 'FS_NOT_REGULAR_FILE':
      return httpError(400, 'NOT_REGULAR_FILE', '目标不是普通文件。')
    case 'FS_SANDBOX_DENIED':
      return httpError(
        403,
        'SANDBOX_DENIED',
        mode === undefined
          ? '当前会话的沙箱策略拒绝了这次修改。'
          : `当前会话处于 ${mode} 沙箱模式，只能在允许的目录内修改。`,
      )
    default:
      return httpError(500, code === '' ? 'INTERNAL' : code, String(error?.message ?? error))
  }
}

/** Map a `node:fs` failure onto the same response vocabulary. */
function mapNodeError(error) {
  switch (error?.code) {
    case 'ENOENT':
      return httpError(404, 'NOT_FOUND', '目标不存在，可能已被移动或删除。')
    case 'EEXIST':
      return httpError(409, 'EXISTS', '同名文件或文件夹已存在。')
    case 'ENOTEMPTY':
      return httpError(409, 'NOT_EMPTY', '文件夹不是空的。')
    case 'EACCES':
    case 'EPERM':
      return httpError(403, 'PERMISSION', '系统拒绝了这次文件操作。')
    case 'EBUSY':
      return httpError(409, 'BUSY', '文件正被其他程序占用。')
    case 'ENOTDIR':
      return httpError(400, 'NOT_DIRECTORY', '路径中包含的不是文件夹。')
    case 'EISDIR':
      return httpError(400, 'IS_DIRECTORY', '目标是一个文件夹。')
    case 'EXDEV':
      return httpError(400, 'CROSS_DEVICE', '不能跨磁盘移动。')
    case 'EINVAL':
      return httpError(400, 'INVALID_NAME', '名称在系统上不合法。')
    default:
      return httpError(500, error?.code ?? 'INTERNAL', String(error?.message ?? error))
  }
}

/**
 * Own one local JSON route: method, plugin header, and origin checks, then the
 * handler, with every thrown failure serialized as `{ error: { code, message } }`.
 */
function route(ctx, handler) {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED', '只接受 POST')
      if (!PLUGIN_TOKENS.has(req.headers[PLUGIN_HEADER])) {
        throw httpError(403, 'FORBIDDEN', `缺少 ${PLUGIN_HEADER} 头`)
      }
      const origin = req.headers.origin
      if (typeof origin === 'string' && origin !== '') {
        let expectedHost
        try {
          expectedHost = new URL(ctx.webServer.getOrigin()).host
        } catch {
          expectedHost = undefined
        }
        let originHost
        try {
          originHost = new URL(origin).host
        } catch {
          originHost = undefined
        }
        if (expectedHost !== undefined && originHost !== expectedHost) {
          throw httpError(403, 'FORBIDDEN', '请求来源不是本机 Harness 页面')
        }
      }
      await handler(req, res)
    } catch (error) {
      const mapped =
        typeof error?.statusCode === 'number'
          ? error
          : typeof error?.code === 'string' && error.code.startsWith('FS_')
            ? mapFsError(error)
            : mapNodeError(error)
      sendJson(res, mapped.statusCode, {
        error: { code: mapped.code, message: mapped.message, details: mapped.details ?? null },
      })
    }
  }
}

function requireSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw httpError(400, 'INVALID_SESSION', '会话 id 非法')
  }
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) {
    throw httpError(404, 'SESSION_NOT_FOUND', '会话不存在或尚未载入')
  }
  return session
}

function requirePath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw httpError(400, 'INVALID_PATH', '文件路径不能为空')
  }
  if (value.includes('\0')) throw httpError(400, 'INVALID_PATH', '文件路径不能包含 NUL 字符')
  return value
}

function cwdOf(session, policy) {
  return session.header.cwd ?? policy.workspaceRoot
}

/** Resolve a caller path against the Session directory into an absolute path. */
function absoluteOf(value, cwd) {
  const path = requirePath(value)
  return isAbsolute(path) ? path : join(cwd, path)
}

function absolutePathOf(ctx, target) {
  try {
    return ctx.fs.processPath(target)
  } catch {
    return target.displayPath
  }
}

function comparable(value) {
  return WINDOWS ? value.toLowerCase() : value
}

function samePath(left, right) {
  return comparable(left) === comparable(right)
}

function isInside(root, child) {
  const rel = relative(root, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Realpath of the nearest existing ancestor. Mutation targets (a new file, a
 * rename destination) do not exist yet, and their writable location is decided
 * by where their parent really is.
 */
async function canonicalAncestor(path) {
  let current = path
  for (;;) {
    try {
      return await realpath(current)
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

async function assertInsideWorkspace(session, policy, absolutePath) {
  const root = await canonicalAncestor(cwdOf(session, policy))
  const target = await canonicalAncestor(absolutePath)
  if (!samePath(root, target) && !isInside(root, target)) {
    throw httpError(403, 'OUTSIDE_WORKSPACE', '文件管理器只在会话工作区内浏览。')
  }
}

/**
 * Apply the session's resolved sandbox policy to one mutation, since these
 * directory operations do not pass through the sandboxed `ctx.fs` backend.
 */
async function assertMutationAllowed(session, policy, absolutePath) {
  if (policy.mode === 'read-only') {
    throw httpError(403, 'SANDBOX_DENIED', '当前会话是只读模式，不能修改文件。')
  }
  if (policy.mode === 'danger-full-access') return
  const target = await canonicalAncestor(absolutePath)
  const roots = [cwdOf(session, policy), tmpdir()].filter(
    (value) => typeof value === 'string' && value !== '',
  )
  for (const root of roots) {
    let canonicalRoot
    try {
      canonicalRoot = await canonicalAncestor(root)
    } catch {
      continue
    }
    if (samePath(canonicalRoot, target) || isInside(canonicalRoot, target)) return
  }
  throw httpError(403, 'SANDBOX_DENIED', '当前沙箱模式只允许在会话工作区或临时目录内修改文件。')
}

async function requireDirectory(path) {
  const info = await lstat(path).catch(() => undefined)
  if (info === undefined) throw httpError(404, 'NOT_FOUND', '上级文件夹不存在。')
  if (!info.isDirectory()) throw httpError(400, 'NOT_DIRECTORY', '上级路径不是文件夹。')
  return info
}

async function requireAbsent(path) {
  const info = await lstat(path).catch(() => undefined)
  if (info !== undefined) throw httpError(409, 'EXISTS', '同名文件或文件夹已存在。')
}

function compareEntries(left, right) {
  const leftDirectory = left.type === 'directory'
  const rightDirectory = right.type === 'directory'
  if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 30_000
const GIT_NETWORK_TIMEOUT_MS = 180_000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
/** Cap on the paths one selective commit may stage. */
const GIT_MAX_SELECTION = 2000
const GIT_URL_RE = /^(https?:\/\/|ssh:\/\/|git:\/\/|git@|file:\/\/)/i

function truncateGitText(value) {
  const text = String(value ?? '').trim()
  return text.length > 900 ? `${text.slice(0, 900)}…` : text
}

/** Turn one git failure into the response vocabulary, with the actionable cases first. */
function gitFailure(message, stderr) {
  const lower = String(stderr ?? '').toLowerCase()
  if (
    /authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|permission denied/.test(
      lower,
    )
  ) {
    return httpError(409, 'GIT_AUTH', 'Git 认证失败：请先在终端配置凭据（credential helper）或 SSH key 后重试。')
  }
  if (/not possible to fast-forward|diverging branches|need to specify how to reconcile/.test(lower)) {
    return httpError(409, 'GIT_DIVERGED', '本地与远端已分叉，无法快进合并。请先在终端处理分支差异。')
  }
  const detail = truncateGitText(stderr)
  return httpError(409, 'GIT_FAILED', detail === '' ? message : `${message}：${detail}`)
}

/** Run one non-interactive git command; never a shell, never an unbounded wait. */
async function runGit(cwd, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: options.timeout ?? GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_MERGE_AUTOEDIT: 'no',
        GIT_EDITOR: 'true',
        GIT_PAGER: 'cat',
        // A file name may contain `*`, `?`, or `[`; git must not read it as a pattern.
        ...(options.literal === true ? { GIT_LITERAL_PATHSPECS: '1' } : {}),
      },
    })
    return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw httpError(503, 'GIT_NOT_FOUND', '没有找到 git 命令，请先安装 Git 并确保它在 PATH 中。')
    }
    if (error?.killed === true) {
      throw httpError(504, 'GIT_TIMEOUT', 'Git 命令超时。')
    }
    throw gitFailure(`git ${args[0]} 失败`, error?.stderr ?? error?.message ?? '')
  }
}

function classifyGitChange(index, worktree) {
  if (
    index === 'U' ||
    worktree === 'U' ||
    (index === 'A' && worktree === 'A') ||
    (index === 'D' && worktree === 'D')
  ) {
    return 'conflict'
  }
  if (index === '?' && worktree === '?') return 'untracked'
  if (index === 'A') return 'added'
  if (index === 'R') return 'renamed'
  if (index === 'C') return 'copied'
  if (index === 'D' || worktree === 'D') return 'deleted'
  if (index === 'M' || worktree === 'M') return 'modified'
  if (index === 'T' || worktree === 'T') return 'typechange'
  return 'changed'
}

/** Parse `git status --porcelain=v1 -z` records, including rename origin paths. */
function parsePorcelainZ(raw) {
  const tokens = String(raw ?? '').split('\0')
  const changes = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '') continue
    const staged = token[0] ?? ' '
    const worktree = token[1] ?? ' '
    const path = token.slice(3)
    let from
    if (staged === 'R' || staged === 'C' || worktree === 'R' || worktree === 'C') {
      from = tokens[index + 1] ?? undefined
      index += 1
    }
    changes.push({
      path,
      from,
      index: staged,
      worktree,
      status: classifyGitChange(staged, worktree),
      staged: staged !== ' ' && staged !== '?',
      untracked: staged === '?' && worktree === '?',
      conflicted:
        staged === 'U' ||
        worktree === 'U' ||
        (staged === 'A' && worktree === 'A') ||
        (staged === 'D' && worktree === 'D'),
    })
  }
  return changes
}

/** Read the repository facts one panel needs; an absent repository is a state, not an error. */
async function readGitStatus(cwd) {
  let probe
  try {
    probe = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch (error) {
    if (error?.code === 'GIT_NOT_FOUND') throw error
    return {
      isRepo: false,
      absolutePath: cwd,
      root: null,
      branch: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      changes: [],
      remotes: [],
      lastCommit: null,
    }
  }
  if (probe.stdout.trim() !== 'true') {
    return {
      isRepo: false,
      absolutePath: cwd,
      root: null,
      branch: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      changes: [],
      remotes: [],
      lastCommit: null,
    }
  }

  const root = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim() || cwd

  let branch = null
  try {
    branch = (await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim() || null
  } catch {
    branch = null
  }

  let upstream = null
  try {
    upstream =
      (await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).stdout.trim() ||
      null
  } catch {
    upstream = null
  }

  let ahead = 0
  let behind = 0
  if (upstream !== null) {
    try {
      const counts = (await runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])).stdout
        .trim()
        .split(/\s+/)
      ahead = Number.parseInt(counts[0] ?? '0', 10) || 0
      behind = Number.parseInt(counts[1] ?? '0', 10) || 0
    } catch {
      ahead = 0
      behind = 0
    }
  }

  let lastCommit = null
  try {
    const line = (await runGit(root, ['log', '-1', '--format=%h%x09%ct%x09%s'])).stdout.trim()
    if (line !== '') {
      const [hash, time, subject] = line.split('\t')
      lastCommit = { hash, time: (Number.parseInt(time ?? '0', 10) || 0) * 1000, subject: subject ?? '' }
    }
  } catch {
    lastCommit = null
  }

  const remotes = []
  const remoteRaw = await runGit(root, ['remote', '-v']).catch(() => ({ stdout: '' }))
  for (const line of remoteRaw.stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim())
    if (match !== null && !remotes.some((remote) => remote.name === match[1])) {
      remotes.push({ name: match[1], url: match[2] })
    }
  }

  const rawStatus = (
    await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ).stdout

  return {
    isRepo: true,
    absolutePath: cwd,
    root,
    branch,
    detached: branch === null,
    upstream,
    ahead,
    behind,
    changes: parsePorcelainZ(rawStatus),
    remotes,
    lastCommit,
  }
}

/** Resolve the repository that contains a path, or fail with a readable state. */
async function requireRepoRoot(path) {
  let probe
  try {
    probe = await runGit(path, ['rev-parse', '--is-inside-work-tree'])
  } catch (error) {
    if (error?.code === 'GIT_NOT_FOUND') throw error
    throw httpError(409, 'NOT_A_REPO', '这里不是 Git 仓库。')
  }
  if (probe.stdout.trim() !== 'true') {
    throw httpError(409, 'NOT_A_REPO', '这里不是 Git 仓库。')
  }
  return (await runGit(path, ['rev-parse', '--show-toplevel'])).stdout.trim() || path
}

function requireGitUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw httpError(400, 'INVALID_GIT_URL', '仓库地址不能为空。')
  }
  const url = value.trim()
  if (url.startsWith('-') || !GIT_URL_RE.test(url)) {
    throw httpError(400, 'INVALID_GIT_URL', '只支持 http(s)、ssh、git、file 形式的仓库地址。')
  }
  return url
}

function requireRepoDirectory(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw httpError(400, 'INVALID_PATH', '目标文件夹名不能为空。')
  }
  const directory = value.trim()
  const parts = directory.split(/[\\/]+/)
  if (directory.startsWith('-') || isAbsolute(directory) || parts.some((part) => part === '..')) {
    throw httpError(400, 'INVALID_PATH', '目标文件夹名不能是绝对路径，也不能包含 ..。')
  }
  return directory
}

/** Reject a selected path that is not a plain repository-relative path. */
function normalizeGitPath(value) {
  if (typeof value !== 'string') {
    throw httpError(400, 'INVALID_SELECTION', '提交列表里只能放文件路径。')
  }
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized === '' || normalized.includes('\0')) {
    throw httpError(400, 'INVALID_SELECTION', '提交列表里有空路径。')
  }
  if (isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.startsWith('/')) {
    throw httpError(400, 'INVALID_SELECTION', '提交列表只能用仓库内的相对路径。')
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw httpError(400, 'INVALID_SELECTION', '提交列表里不能有 ..。')
  }
  return normalized
}

/**
 * Validate the caller's file selection against the repository's current
 * changes. An absent `paths` keeps the older "commit everything" behaviour;
 * an explicit empty list is a client mistake, not a request to commit all.
 */
function resolveGitSelection(raw, changes, root) {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) {
    throw httpError(400, 'INVALID_SELECTION', 'paths 必须是数组。')
  }
  // A rename appears as one record whose `from` path is an alias of the new
  // one, so both spellings of the same change map to the same selection.
  const known = new Map()
  for (const change of changes) {
    known.set(change.path, change.path)
    if (typeof change.from === 'string' && change.from !== '') known.set(change.from, change.path)
  }
  const selected = []
  const seen = new Set()
  for (const entry of raw) {
    const normalized = normalizeGitPath(entry)
    if (!isInside(root, resolve(root, normalized))) {
      throw httpError(400, 'INVALID_SELECTION', '只能提交仓库内的文件。')
    }
    const canonical = known.get(normalized)
    if (canonical === undefined) {
      throw httpError(409, 'UNKNOWN_PATH', `变更列表里没有这个文件：${truncateGitText(normalized)}`)
    }
    if (seen.has(canonical)) continue
    seen.add(canonical)
    selected.push(canonical)
  }
  if (selected.length === 0) {
    throw httpError(400, 'NO_SELECTION', '请先选择要提交的文件。')
  }
  if (selected.length > GIT_MAX_SELECTION) {
    throw httpError(400, 'INVALID_SELECTION', '一次选择的文件太多了。')
  }
  return selected
}

/** A rename needs both paths in the pathspec so git still records a rename. */
function gitPathspecOf(selected, changes) {
  const pathspec = []
  for (const path of selected) {
    pathspec.push(path)
    const change = changes.find((entry) => entry.path === path)
    if (change !== undefined && typeof change.from === 'string' && change.from !== '') {
      pathspec.push(change.from)
    }
  }
  return pathspec
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/read`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const path = requirePath(body.path)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const target = await ctx.fs.resolve(path, { cwd })
        const info = await ctx.fs.stat(target)
        if (info === undefined) throw httpError(404, 'NOT_FOUND', '文件不存在，可能已被移动或删除。')
        if (info.type !== 'file') throw httpError(400, 'NOT_REGULAR_FILE', '目标不是普通文件，无法编辑。')
        if (typeof info.size === 'number' && info.size > MAX_READ_BYTES) {
          throw httpError(413, 'TOO_LARGE', `文件超过 ${Math.round(MAX_READ_BYTES / 1024 / 1024)} MiB，无法在侧栏编辑器中打开。`)
        }
        const content = await ctx.fs.readText(target)
        if (Buffer.byteLength(content, 'utf8') > MAX_READ_BYTES) {
          throw httpError(413, 'TOO_LARGE', `文件超过 ${Math.round(MAX_READ_BYTES / 1024 / 1024)} MiB，无法在侧栏编辑器中打开。`)
        }
        sendJson(res, 200, {
          ok: true,
          content,
          version: info.version,
          absolutePath: absolutePathOf(ctx, target),
          bytes: info.size ?? Buffer.byteLength(content, 'utf8'),
        })
      }),
    }),
    'sidebar-editor: read route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/write`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const path = requirePath(body.path)
        if (typeof body.content !== 'string') throw httpError(400, 'INVALID_CONTENT', 'content 必须是字符串')
        const bytes = Buffer.byteLength(body.content, 'utf8')
        if (bytes > MAX_WRITE_BYTES) {
          throw httpError(413, 'TOO_LARGE', `内容超过 ${Math.round(MAX_WRITE_BYTES / 1024 / 1024)} MiB，无法保存。`)
        }
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)

        // Reject a symlink or a directory before resolving; the sandbox backend
        // still re-canonicalizes and fences the actual write below.
        const listed = await ctx.fs.lstat(path, { cwd })
        if (listed !== undefined) {
          if (listed.type === 'symlink') throw httpError(400, 'SYMLINK', '不通过符号链接保存文件。')
          if (listed.type !== 'file') throw httpError(400, 'NOT_REGULAR_FILE', '目标不是普通文件，无法编辑。')
          if (typeof listed.size === 'number' && listed.size > MAX_WRITE_BYTES) {
            throw httpError(413, 'TOO_LARGE', `文件超过 ${Math.round(MAX_WRITE_BYTES / 1024 / 1024)} MiB，无法保存。`)
          }
        }

        const target = await ctx.fs.resolve(path, { cwd })
        const expected =
          typeof body.version === 'string' && body.version !== ''
            ? { kind: 'replaceIfVersion', version: body.version }
            : undefined
        const outcome = await ctx.fs.writeText(target, body.content, expected, undefined, policy)
        sendJson(res, 200, {
          ok: true,
          version: outcome.version,
          operation: outcome.operation,
          absolutePath: absolutePathOf(ctx, target),
          bytes,
        })
      }),
    }),
    'sidebar-editor: write route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/list`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const requested = absoluteOf(body.path ?? cwd, cwd)
        await assertInsideWorkspace(session, policy, requested)
        const target = await ctx.fs.resolve(requested, { cwd })
        const info = await ctx.fs.stat(target)
        if (info === undefined) throw httpError(404, 'NOT_FOUND', '文件夹不存在，可能已被移动或删除。')
        if (info.type !== 'directory') throw httpError(400, 'NOT_DIRECTORY', '目标不是文件夹。')
        const absolutePath = absolutePathOf(ctx, target)
        const children = await ctx.fs.listDir(target)
        const entries = children.map((child) => ({
          name: child.name,
          type: child.type,
          path: join(absolutePath, child.name),
          size: typeof child.size === 'number' ? child.size : null,
        }))
        entries.sort(compareEntries)
        sendJson(res, 200, {
          ok: true,
          absolutePath,
          parent: dirname(absolutePath),
          // Canonical, so the Client's "at the workspace root" check compares
          // identity rather than spelling (casing, junctions, symlinks).
          workspaceRoot: await canonicalAncestor(cwd),
          entries: entries.slice(0, MAX_LIST_ENTRIES),
          truncated: entries.length > MAX_LIST_ENTRIES,
        })
      }),
    }),
    'sidebar-editor: list route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/create`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const absolutePath = absoluteOf(body.path, cwd)
        await assertMutationAllowed(session, policy, absolutePath)
        await requireDirectory(dirname(absolutePath))
        await requireAbsent(absolutePath)
        const target = await ctx.fs.resolve(absolutePath, { cwd })
        const outcome = await ctx.fs.writeText(target, '', { kind: 'createIfAbsent' }, undefined, policy)
        sendJson(res, 200, { ok: true, absolutePath: absolutePathOf(ctx, target), version: outcome.version })
      }),
    }),
    'sidebar-editor: create route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/mkdir`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const absolutePath = absoluteOf(body.path, cwd)
        await assertMutationAllowed(session, policy, absolutePath)
        await requireDirectory(dirname(absolutePath))
        await requireAbsent(absolutePath)
        try {
          await mkdir(absolutePath)
        } catch (error) {
          throw mapNodeError(error)
        }
        sendJson(res, 200, { ok: true, absolutePath })
      }),
    }),
    'sidebar-editor: mkdir route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/rename`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const from = absoluteOf(body.from, cwd)
        const to = absoluteOf(body.to, cwd)
        await assertMutationAllowed(session, policy, from)
        await assertMutationAllowed(session, policy, to)
        const info = await lstat(from).catch(() => undefined)
        if (info === undefined) throw httpError(404, 'NOT_FOUND', '要重命名的目标不存在。')
        if (info.isSymbolicLink()) throw httpError(400, 'SYMLINK', '不重命名符号链接。')
        const root = await canonicalAncestor(cwdOf(session, policy))
        const canonicalFrom = await canonicalAncestor(from)
        if (samePath(root, canonicalFrom)) {
          throw httpError(400, 'WORKSPACE_ROOT', '不能重命名会话工作区根目录。')
        }
        await requireDirectory(dirname(to))
        await requireAbsent(to)
        try {
          await rename(from, to)
        } catch (error) {
          throw mapNodeError(error)
        }
        sendJson(res, 200, { ok: true, absolutePath: to })
      }),
    }),
    'sidebar-editor: rename route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/delete`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const absolutePath = absoluteOf(body.path, cwd)
        await assertMutationAllowed(session, policy, absolutePath)
        const info = await lstat(absolutePath).catch(() => undefined)
        if (info === undefined) throw httpError(404, 'NOT_FOUND', '要删除的目标不存在。')
        if (info.isSymbolicLink()) throw httpError(400, 'SYMLINK', '不删除符号链接。')
        const root = await canonicalAncestor(cwdOf(session, policy))
        const canonicalTarget = await canonicalAncestor(absolutePath)
        if (samePath(root, canonicalTarget)) {
          throw httpError(400, 'WORKSPACE_ROOT', '不能删除会话工作区根目录。')
        }
        try {
          await rm(absolutePath, { recursive: info.isDirectory(), force: false })
        } catch (error) {
          throw mapNodeError(error)
        }
        sendJson(res, 200, { ok: true, absolutePath })
      }),
    }),
    'sidebar-editor: delete route',
  )

  // -------------------------------------------------------------------------
  // Git routes
  // -------------------------------------------------------------------------

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/git/status`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const requested = absoluteOf(body.path ?? cwd, cwd)
        await assertInsideWorkspace(session, policy, requested)
        const info = await lstat(requested).catch(() => undefined)
        if (info === undefined) throw httpError(404, 'NOT_FOUND', '目录不存在。')
        if (!info.isDirectory()) throw httpError(400, 'NOT_DIRECTORY', 'Git 面板需要一个目录。')
        const status = await readGitStatus(requested)
        sendJson(res, 200, { ok: true, status: { ...status, workspaceRoot: cwd } })
      }),
    }),
    'sidebar-editor: git status route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/git/init`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const requested = absoluteOf(body.path ?? cwd, cwd)
        await assertInsideWorkspace(session, policy, requested)
        const info = await lstat(requested).catch(() => undefined)
        if (info === undefined) throw httpError(404, 'NOT_FOUND', '目录不存在。')
        if (!info.isDirectory()) throw httpError(400, 'NOT_DIRECTORY', '只能在文件夹里初始化仓库。')
        const probe = await runGit(requested, ['rev-parse', '--is-inside-work-tree']).catch(() => undefined)
        if (probe !== undefined && probe.stdout.trim() === 'true') {
          throw httpError(409, 'ALREADY_REPO', '这里已经是 Git 仓库。')
        }
        await assertMutationAllowed(session, policy, requested)
        await runGit(requested, ['init'])
        const status = await readGitStatus(requested)
        sendJson(res, 200, { ok: true, status: { ...status, workspaceRoot: cwd } })
      }),
    }),
    'sidebar-editor: git init route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/git/clone`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const url = requireGitUrl(body.url)
        const directory = requireRepoDirectory(body.directory)
        const target = join(cwd, directory)
        await assertInsideWorkspace(session, policy, target)
        await assertMutationAllowed(session, policy, target)
        await requireDirectory(dirname(target))
        await requireAbsent(target)
        const args = ['clone']
        const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
        if (branch !== '') args.push('--branch', branch)
        args.push('--', url, target)
        await runGit(cwd, args, { timeout: GIT_NETWORK_TIMEOUT_MS })
        const status = await readGitStatus(target)
        sendJson(res, 200, { ok: true, absolutePath: target, status: { ...status, workspaceRoot: cwd } })
      }),
    }),
    'sidebar-editor: git clone route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/git/fetch`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const requested = absoluteOf(body.path ?? cwd, cwd)
        await assertInsideWorkspace(session, policy, requested)
        const root = await requireRepoRoot(requested)
        await assertMutationAllowed(session, policy, root)
        await runGit(root, ['fetch', '--all', '--prune'], { timeout: GIT_NETWORK_TIMEOUT_MS })
        const status = await readGitStatus(root)
        sendJson(res, 200, { ok: true, status: { ...status, workspaceRoot: cwd } })
      }),
    }),
    'sidebar-editor: git fetch route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/git/pull`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const requested = absoluteOf(body.path ?? cwd, cwd)
        await assertInsideWorkspace(session, policy, requested)
        const root = await requireRepoRoot(requested)
        await assertMutationAllowed(session, policy, root)
        const before = await readGitStatus(root)
        if (before.upstream === null) {
          throw httpError(409, 'NO_UPSTREAM', '当前分支没有上游分支，无法拉取。先推送一次以建立上游。')
        }
        await runGit(root, ['-c', 'pull.rebase=false', 'pull', '--ff-only'], {
          timeout: GIT_NETWORK_TIMEOUT_MS,
        })
        const status = await readGitStatus(root)
        sendJson(res, 200, { ok: true, status: { ...status, workspaceRoot: cwd } })
      }),
    }),
    'sidebar-editor: git pull route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/git/commit`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const requested = absoluteOf(body.path ?? cwd, cwd)
        await assertInsideWorkspace(session, policy, requested)
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        if (message === '') throw httpError(400, 'EMPTY_MESSAGE', '请填写提交信息。')
        const root = await requireRepoRoot(requested)
        await assertMutationAllowed(session, policy, root)
        const before = await readGitStatus(root)
        if (before.changes.length === 0) throw httpError(409, 'NO_CHANGES', '没有可提交的变更。')
        const selected = resolveGitSelection(body.paths, before.changes, root)
        if (selected === null) {
          // Legacy callers: stage the whole working tree.
          await runGit(root, ['add', '-A'])
          await runGit(root, ['commit', '--no-gpg-sign', '-m', message])
        } else {
          // Stage exactly the selected paths (`-A` covers untracked files,
          // deletions, and renames), then commit only those paths so changes
          // staged earlier for other files stay out of this commit.
          const pathspec = gitPathspecOf(selected, before.changes)
          // Stage only the files the user picked; `from` paths of a rename stay
          // out of this step because a staged rename already holds that deletion.
          await runGit(root, ['add', '-A', '--', ...selected], { literal: true })
          const staged = (
            await runGit(root, ['diff', '--cached', '--name-only', '--', ...pathspec], {
              literal: true,
            })
          ).stdout.trim()
          if (staged === '') {
            throw httpError(409, 'NO_STAGED', '所选文件没有可提交的变更。')
          }
          await runGit(root, ['commit', '--only', '--no-gpg-sign', '-m', message, '--', ...pathspec], {
            literal: true,
          })
        }
        const status = await readGitStatus(root)
        sendJson(res, 200, { ok: true, status: { ...status, workspaceRoot: cwd } })
      }),
    }),
    'sidebar-editor: git commit route',
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/git/push`,
      handler: route(ctx, async (req, res) => {
        const body = await readBody(req)
        const session = requireSession(ctx, body.sessionId)
        const policy = ctx.sandboxPolicy.resolve({ session })
        const cwd = cwdOf(session, policy)
        const requested = absoluteOf(body.path ?? cwd, cwd)
        await assertInsideWorkspace(session, policy, requested)
        const root = await requireRepoRoot(requested)
        await assertMutationAllowed(session, policy, root)
        const before = await readGitStatus(root)
        if (before.remotes.length === 0) {
          throw httpError(409, 'NO_REMOTE', '没有配置远程仓库，无法推送。')
        }
        const remote = before.remotes.some((entry) => entry.name === 'origin')
          ? 'origin'
          : before.remotes[0].name
        const args = before.upstream === null ? ['push', '-u', remote, 'HEAD'] : ['push']
        await runGit(root, args, { timeout: GIT_NETWORK_TIMEOUT_MS })
        const status = await readGitStatus(root)
        sendJson(res, 200, { ok: true, status: { ...status, workspaceRoot: cwd } })
      }),
    }),
    'sidebar-editor: git push route',
  )
}
