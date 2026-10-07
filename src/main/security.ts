import { app, session } from 'electron';
import { join } from 'node:path';

/**
 * Keeps all application data on this PC. On Windows the profile lives in
 * %LOCALAPPDATA% rather than the roaming %APPDATA%, so it is never synchronised to a
 * server by roaming profiles. Must run before the app is ready.
 */
export function useLocalProfile(): void {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    app.setPath('userData', join(process.env.LOCALAPPDATA, 'Planner'));
  }
}

/**
 * The user interface may not talk to the network at all: every request from the
 * default session that is not a local file is cancelled, and all permission requests
 * (camera, microphone, notifications, geolocation…) are denied. The updater uses its
 * own HTTPS-only session (see update/transport.ts) and is the only network client.
 */
export function lockDownNetwork(): void {
  const devServer = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  const devOrigin = devServer ? new URL(devServer).origin : null;
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const local =
      url.startsWith('file:') ||
      url.startsWith('devtools:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      (devOrigin !== null && (url.startsWith(devOrigin) || url.startsWith(devOrigin.replace(/^http/, 'ws'))));
    callback({ cancel: !local });
  });
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // No spell-check dictionaries are downloaded; Windows uses its built-in spell checker.
  if (process.platform !== 'win32' && process.platform !== 'darwin') ses.setSpellCheckerEnabled(false);
}
