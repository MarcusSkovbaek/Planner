import { appDisplayName, appKeyFromProcess } from '@core/activity/apps';
import type { WindowProvider, WindowSample } from '@core/tracking/types';

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const MAX_TITLE = 1024;
const MAX_PATH = 1024;
const PROCESS_CACHE_MS = 60_000;

type Fn = (...args: unknown[]) => unknown;

interface Win32Functions {
  GetForegroundWindow: Fn;
  GetWindowTextW: Fn;
  GetWindowTextLengthW: Fn;
  GetWindowThreadProcessId: Fn;
  OpenProcess: Fn;
  QueryFullProcessImageNameW: Fn;
  CloseHandle: Fn;
}

let bindings: Win32Functions | null = null;

export interface Win32Libraries {
  user32: string;
  kernel32: string;
}

const SYSTEM_LIBRARIES: Win32Libraries = { user32: 'user32.dll', kernel32: 'kernel32.dll' };

/** Declares the Win32 functions once per process (koffi type names are global). */
function loadBindings(libs: Win32Libraries): Win32Functions {
  if (bindings) return bindings;
  // Loaded lazily so non-Windows builds and tests never touch the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const user32 = koffi.load(libs.user32);
  const kernel32 = koffi.load(libs.kernel32);
  const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
  koffi.alias('HWND', HANDLE);
  koffi.alias('DWORD', 'uint32_t');
  bindings = {
    GetForegroundWindow: user32.func('HWND __stdcall GetForegroundWindow()'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(HWND hWnd, _Out_ void *lpString, int nMaxCount)'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(HWND hWnd)'),
    GetWindowThreadProcessId: user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)'),
    OpenProcess: kernel32.func('HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, int bInheritHandle, DWORD dwProcessId)'),
    QueryFullProcessImageNameW: kernel32.func(
      'int __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, _Out_ void *lpExeName, _Inout_ DWORD *lpdwSize)',
    ),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(HANDLE hObject)'),
  };
  return bindings;
}

/**
 * Reads the foreground window directly from user32/kernel32 through koffi (prebuilt
 * N-API FFI, no compiler needed). Cost per sample is a few microseconds.
 */
export class Win32Provider implements WindowProvider {
  readonly id = 'win32';
  private fn: Win32Functions | null = null;
  private readonly processCache = new Map<number, { path: string; at: number }>();
  private readonly titleBuffer = Buffer.alloc((MAX_TITLE + 1) * 2);
  private readonly pathBuffer = Buffer.alloc((MAX_PATH + 1) * 2);

  /** `libraries` can point at stand-in libraries so the bindings can be tested off Windows. */
  constructor(private readonly libraries: Win32Libraries = SYSTEM_LIBRARIES) {}

  init(): void {
    if (process.platform !== 'win32' && this.libraries === SYSTEM_LIBRARIES) throw new Error('Win32 provider requires Windows');
    this.fn = loadBindings(this.libraries);
    // Fail fast if the bindings do not work on this machine.
    this.fn.GetForegroundWindow();
  }

  sample(): WindowSample | null {
    const fn = this.fn;
    if (!fn) throw new Error('Win32 provider not initialised');
    const hwnd = fn.GetForegroundWindow();
    if (!hwnd) return null;

    const pidOut: [number | null] = [null];
    if (!fn.GetWindowThreadProcessId(hwnd, pidOut)) return null;
    const pid = Number(pidOut[0] ?? 0);
    if (pid === process.pid) return { app: 'planner', appName: 'Planner', title: 'Planner', pid, isSelf: true };

    const length = Math.min(MAX_TITLE, Number(fn.GetWindowTextLengthW(hwnd)) || 0);
    let title = '';
    if (length > 0) {
      const copied = Number(fn.GetWindowTextW(hwnd, this.titleBuffer, length + 1)) || 0;
      title = this.titleBuffer.toString('utf16le', 0, copied * 2);
    }

    const path = this.processPath(pid);
    // Elevated processes (e.g. Task Manager) cannot be queried without admin rights.
    const app = path ? appKeyFromProcess(path) : 'unknown';
    return { app, appName: appDisplayName(app), title, pid };
  }

  dispose(): void {
    this.fn = null;
    this.processCache.clear();
  }

  private processPath(pid: number): string {
    const now = Date.now();
    const cached = this.processCache.get(pid);
    if (cached && now - cached.at < PROCESS_CACHE_MS) return cached.path;

    const fn = this.fn!;
    let path = '';
    const handle = fn.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (handle) {
      try {
        const size: [number] = [MAX_PATH];
        if (fn.QueryFullProcessImageNameW(handle, 0, this.pathBuffer, size)) {
          path = this.pathBuffer.toString('utf16le', 0, Number(size[0]) * 2);
        }
      } finally {
        fn.CloseHandle(handle);
      }
    }
    this.processCache.set(pid, { path, at: now });
    if (this.processCache.size > 256) {
      for (const [key, value] of this.processCache) if (now - value.at >= PROCESS_CACHE_MS) this.processCache.delete(key);
    }
    return path;
  }
}
