import { app, net, session, type Session } from 'electron';
import { createWriteStream, promises as fs } from 'node:fs';
import { UpdateError } from './manifest';
import type { UpdateTransport } from './SecureUpdater';

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 60_000;

let updaterSession: Session | null = null;

/**
 * A private, in-memory network session used only by the updater: no cookies, no cache,
 * no credentials, and every request (including redirects) must use HTTPS.
 */
function getSession(): Session {
  if (updaterSession) return updaterSession;
  updaterSession = session.fromPartition('planner-updater', { cache: false });
  updaterSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('https://') }));
  updaterSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return updaterSession;
}

function request(url: string, onResponse: (response: Electron.IncomingMessage, done: (err?: Error) => void) => void): Promise<void> {
  if (!url.startsWith('https://')) return Promise.reject(new UpdateError('INSECURE_URL', url));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const req = net.request({ url, session: getSession(), redirect: 'manual', credentials: 'omit', useSessionCookies: false, cache: 'no-store' });
    // Note: settle before aborting, because abort() emits 'abort' synchronously.
    const timer = setTimeout(() => {
      finish(new UpdateError('NETWORK', 'timeout'));
      req.abort();
    }, TIMEOUT_MS);
    let redirects = 0;
    req.setHeader('User-Agent', `Planner/${app.getVersion()}`);
    req.on('redirect', (_status, _method, redirectUrl) => {
      if (++redirects > MAX_REDIRECTS || !redirectUrl.startsWith('https://')) {
        finish(new UpdateError('INSECURE_URL', redirectUrl));
        req.abort();
        return;
      }
      req.followRedirect();
    });
    req.on('response', (response) => {
      if (response.statusCode !== 200) {
        finish(new UpdateError('HTTP_STATUS', String(response.statusCode)));
        req.abort();
        return;
      }
      onResponse(response, (err) => {
        finish(err);
        if (err) req.abort();
      });
    });
    req.on('error', (err) => finish(new UpdateError('NETWORK', err.message)));
    req.on('abort', () => finish(new UpdateError('NETWORK', 'aborted')));
    req.end();
  });
}

export const electronTransport: UpdateTransport = {
  async fetchText(url, maxBytes) {
    const chunks: Buffer[] = [];
    let size = 0;
    await request(url, (response, done) => {
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) return done(new UpdateError('TOO_LARGE'));
        chunks.push(chunk);
      });
      response.on('end', () => done());
      response.on('error', (err: Error) => done(new UpdateError('NETWORK', err.message)));
    });
    return Buffer.concat(chunks).toString('utf8');
  },

  async download(url, destination, { maxBytes, onProgress }) {
    const file = createWriteStream(destination, { flags: 'w' });
    let received = 0;
    try {
      await request(url, (response, done) => {
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) return done(new UpdateError('TOO_LARGE'));
          // Disk writes outpace the network, so the write stream's buffer stays small.
          file.write(chunk);
          onProgress(received);
        });
        response.on('end', () => file.end(() => done()));
        response.on('error', (err: Error) => done(new UpdateError('NETWORK', err.message)));
        file.on('error', (err) => done(new UpdateError('NETWORK', err.message)));
      });
    } catch (err) {
      file.destroy();
      await fs.rm(destination, { force: true }).catch(() => undefined);
      throw err;
    }
  },
};
