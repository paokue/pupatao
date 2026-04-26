// Bunny CDN — Storage API upload helper. Reads credentials from .env:
//
//   BUNNY_STORAGE_ZONE   — e.g. "pupatao-storage"
//   BUNNY_API_KEY        — storage-zone access key (not the account key)
//   BUNNY_BASE_HOSTNAME  — e.g. "storage.bunnycdn.com" or regional "sg.storage.bunnycdn.com"
//   BUNNY_CDN_HOST       — public CDN host, e.g. "pupatao.b-cdn.net"
//
// Uses Node's built-in `https` module instead of `fetch`/undici because undici's
// default 10 s TCP-connect timeout is too aggressive for cross-region hops (e.g.
// Laos → Falkenstein), producing `ConnectTimeoutError` on perfectly valid
// credentials. This mirrors what `axios` / `node-fetch` do under the hood.
//
// Docs: https://docs.bunny.net/reference/put_-storagezonename-path-filename-

import https from 'node:https'

export interface BunnyConfig {
  zone: string
  accessKey: string
  baseHost: string
  cdnHost: string
}

function readConfig(): BunnyConfig {
  const zone = process.env.BUNNY_STORAGE_ZONE
  const accessKey = process.env.BUNNY_API_KEY
  const cdnHost = process.env.BUNNY_CDN_HOST
  const baseHost = process.env.BUNNY_BASE_HOSTNAME || 'storage.bunnycdn.com'
  if (!zone || !accessKey || !cdnHost) {
    throw new Error(
      'Bunny CDN is not configured. Set BUNNY_STORAGE_ZONE, BUNNY_API_KEY, BUNNY_CDN_HOST in .env.',
    )
  }
  return { zone, accessKey, cdnHost, baseHost }
}

// Normalise a CDN host like "pupatao.b-cdn.net" or "https://pupatao.b-cdn.net/".
function publicUrlPrefix(cdnHost: string): string {
  const hasProtocol = /^https?:\/\//i.test(cdnHost)
  const trimmed = cdnHost.replace(/\/+$/, '')
  return hasProtocol ? trimmed : `https://${trimmed}`
}

// Raw HTTPS request wrapper. Returns { status, body } so callers can decide how
// to react to 4xx / 5xx. Rejects on network errors.
function httpsRequest(opts: {
  method: string
  host: string
  path: string
  headers?: Record<string, string | number>
  body?: Buffer
  timeoutMs?: number
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: opts.method,
        host: opts.host,
        path: opts.path,
        headers: opts.headers,
        // Generous socket-level idle timeout; Node's default is forever.
        timeout: opts.timeoutMs ?? 120_000,
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c as Buffer))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error(`Timed out after ${opts.timeoutMs ?? 120_000}ms`))
    })
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

// PUT the given bytes to `<baseHost>/<zone>/<path>` and return the public CDN URL.
export async function uploadToBunny(opts: {
  body: ArrayBuffer | Buffer | Uint8Array
  /** Path inside the storage zone, e.g. "avatars/abc123.jpg". No leading slash. */
  path: string
  contentType: string
  /** Socket idle timeout (default 120 s). */
  timeoutMs?: number
}): Promise<{ url: string; path: string }> {
  const cfg = readConfig()
  const cleanPath = opts.path.replace(/^\/+/, '')
  const uploadUrl = `https://${cfg.baseHost}/${cfg.zone}/${cleanPath}`

  // Coerce all accepted input shapes into a Buffer. `Buffer.from` has distinct
  // overloads for ArrayBuffer vs ArrayLike<number>, so we have to branch to
  // help TS pick the right one.
  const body: Buffer =
    opts.body instanceof Buffer
      ? opts.body
      : opts.body instanceof Uint8Array
        ? Buffer.from(opts.body)
        : Buffer.from(opts.body as ArrayBuffer)

  let result: { status: number; body: string }
  try {
    result = await httpsRequest({
      method: 'PUT',
      host: cfg.baseHost,
      path: `/${cfg.zone}/${cleanPath}`,
      headers: {
        AccessKey: cfg.accessKey,
        'Content-Type': opts.contentType,
        'Content-Length': body.length,
      },
      body,
      timeoutMs: opts.timeoutMs,
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    console.error('[bunny] network error reaching', uploadUrl, '-', err instanceof Error ? err.message : String(err), code ? `(code: ${code})` : '')
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || (err instanceof Error && /Timed out/.test(err.message))) {
      throw new Error(
        `Cannot reach Bunny (${cfg.baseHost}) from this network within the timeout. ` +
        `Try a closer region host in BUNNY_BASE_HOSTNAME (e.g. sg.storage.bunnycdn.com), or check your network/VPN.`,
      )
    }
    if (code === 'ENOTFOUND') {
      throw new Error(`DNS lookup failed for ${cfg.baseHost}. Check BUNNY_BASE_HOSTNAME spelling.`)
    }
    throw new Error(
      `Bunny network error: ${err instanceof Error ? err.message : 'unknown'}${code ? ` (${code})` : ''}`,
    )
  }

  if (result.status < 200 || result.status >= 300) {
    console.error(
      '[bunny] upload rejected:',
      JSON.stringify({
        status: result.status,
        zone: cfg.zone,
        baseHost: cfg.baseHost,
        path: cleanPath,
        url: uploadUrl,
        body: result.body.slice(0, 300),
      }),
    )
    if (result.status === 401) {
      throw new Error(
        `Bunny rejected the access key for zone "${cfg.zone}" on host ${cfg.baseHost}. ` +
        `Use the zone's "Password" (not the account API key), and make sure BUNNY_BASE_HOSTNAME matches the zone's region.`,
      )
    }
    throw new Error(`Bunny upload failed (${result.status}): ${result.body.slice(0, 200)}`)
  }

  return {
    url: `${publicUrlPrefix(cfg.cdnHost)}/${cleanPath}`,
    path: cleanPath,
  }
}

// Best-effort delete an old avatar. Returns silently on failure — we don't want
// a slow cleanup to fail a user-initiated save.
export async function deleteFromBunny(path: string): Promise<void> {
  try {
    const cfg = readConfig()
    const cleanPath = path.replace(/^\/+/, '')
    await httpsRequest({
      method: 'DELETE',
      host: cfg.baseHost,
      path: `/${cfg.zone}/${cleanPath}`,
      headers: { AccessKey: cfg.accessKey },
      timeoutMs: 30_000,
    })
  } catch {
    // swallow — see comment above
  }
}
