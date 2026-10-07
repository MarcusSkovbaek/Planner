import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appDisplayName, appKeyFromProcess } from '@core/activity/apps';
import type { WindowProvider, WindowSample } from '@core/tracking/types';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PlannerWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$names = @{}
while ($true) {
  $h = [PlannerWin32]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 1024
  [void][PlannerWin32]::GetWindowText($h, $sb, 1024)
  $procId = [uint32]0
  [void][PlannerWin32]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = $names[$procId]
  if (-not $name) {
    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $name = '' }
    if ($names.Count -gt 200) { $names.Clear() }
    $names[$procId] = $name
  }
  [Console]::Out.WriteLine((@{ t = $sb.ToString(); p = [int]$procId; n = $name } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}
`;

const START_TIMEOUT_MS = 20_000;
const STALE_AFTER_MS = 10_000;

/**
 * Fallback for machines where the native FFI module cannot load: a long-lived hidden
 * PowerShell process reports the foreground window once per second as JSON lines.
 */
export class PowerShellProvider implements WindowProvider {
  readonly id = 'powershell';
  private child: ChildProcessWithoutNullStreams | null = null;
  private latest: WindowSample | null = null;
  private latestAt = 0;

  init(): Promise<void> {
    if (process.platform !== 'win32') return Promise.reject(new Error('PowerShell provider requires Windows'));
    return new Promise((resolve, reject) => {
      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        windowsHide: true,
      });
      this.child = child;
      let settled = false;
      let stderr = '';
      const timer = setTimeout(() => finish(new Error('PowerShell did not respond')), START_TIMEOUT_MS);
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.dispose();
          reject(err);
        } else {
          resolve();
        }
      };

      createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const data = JSON.parse(line) as { t?: string; p?: number; n?: string };
          const pid = Number(data.p ?? 0);
          const app = data.n ? appKeyFromProcess(data.n) : 'unknown';
          this.latest =
            pid === process.pid
              ? { app: 'planner', appName: 'Planner', title: 'Planner', pid, isSelf: true }
              : { app, appName: appDisplayName(app), title: String(data.t ?? ''), pid };
          this.latestAt = Date.now();
          finish();
        } catch {
          // Ignore partial or non-JSON lines.
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      child.on('error', (err) => finish(err));
      child.on('exit', (code) => {
        this.child = null;
        finish(new Error(`PowerShell exited (${code}) ${stderr.trim()}`.trim()));
      });
    });
  }

  sample(): WindowSample | null {
    if (!this.child) throw new Error('PowerShell provider stopped');
    if (Date.now() - this.latestAt > STALE_AFTER_MS) return null;
    return this.latest;
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
  }
}
