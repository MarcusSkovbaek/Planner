import { spawn } from 'node:child_process';
import type { CalendarSource } from '@core/calendar';
import type { DateKey } from '@core/model';
import { isDateKey } from '@core/time';

/**
 * Prints the appointments in the default Outlook calendar that overlap one day, as JSON.
 * The day comes from an environment variable, so the script itself never changes and no
 * data is ever pasted into it. It reads only properties that do not trigger Outlook's
 * security prompt (never the body, organizer or attendees).
 */
export const OUTLOOK_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$from = [datetime]::ParseExact($env:PLANNER_CALENDAR_DAY, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
$to = $from.AddDays(1)
# Outlook started here is closed again at the end, unless the user opened a window meanwhile.
$started = $false
try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { $ol = New-Object -ComObject Outlook.Application; $started = $true }
$list = New-Object System.Collections.ArrayList
try {
  $ns = $ol.GetNamespace('MAPI')
  $folder = $ns.GetDefaultFolder(9)
  $items = $folder.Items
  $items.Sort('[Start]')
  $items.IncludeRecurrences = $true
  # Never enumerate without Restrict while IncludeRecurrences is on: endless series never stop.
  $filter = "[Start] < '" + $to.ToString('g') + "' AND [End] > '" + $from.ToString('g') + "'"
  $found = $items.Restrict($filter)
  foreach ($i in $found) {
    if ($list.Count -ge 500) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($i); break }
    try {
      [void]$list.Add([pscustomobject]@{
        id = [string]$i.EntryID
        subject = [string]$i.Subject
        location = [string]$i.Location
        start = [DateTimeOffset]::new($i.Start).ToUnixTimeMilliseconds()
        end = [DateTimeOffset]::new($i.End).ToUnixTimeMilliseconds()
        allDay = [bool]$i.AllDayEvent
        busy = [int]$i.BusyStatus
        status = [int]$i.MeetingStatus
        response = [int]$i.ResponseStatus
      })
    } catch { }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($i)
  }
} finally {
  try { if ($started -and $ol.Explorers.Count -eq 0) { $ol.Quit() } } catch { }
  foreach ($o in $found, $items, $folder, $ns, $ol) {
    if ($null -ne $o) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } }
  }
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($list) -Compress))
`;

export const DAY_VARIABLE = 'PLANNER_CALENDAR_DAY';
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 4 * 1024 * 1024;

/** The PowerShell command line that reads `date`. The script is passed encoded and constant. */
export function outlookCommand(date: DateKey): { file: string; args: string[]; env: Record<string, string> } {
  if (!isDateKey(date)) throw new Error(`Invalid date: ${String(date)}`);
  const encoded = Buffer.from(OUTLOOK_SCRIPT, 'utf16le').toString('base64');
  return {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    env: { [DAY_VARIABLE]: date },
  };
}

/** Parses what the script printed. Throws on anything that is not JSON. */
export function parseOutlookOutput(stdout: string): unknown {
  const text = stdout.replace(/^\uFEFF/, '').trim();
  return text ? JSON.parse(text) : [];
}

/** Reads the classic Outlook calendar through its COM object model (Windows only). */
export class OutlookCalendarSource implements CalendarSource {
  readonly id = 'outlook';

  read(date: DateKey): Promise<unknown> {
    if (process.platform !== 'win32') return Promise.reject(new Error('The Outlook calendar requires Windows'));
    const { file, args, env } = outlookCommand(date);
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        windowsHide: true,
        env: { ...process.env, ...env },
        // Windows PowerShell 5.1 can wait for input on an open stdin and never exit.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (err: Error | null, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          child.kill();
          console.warn('Planner: the Outlook calendar could not be read.', err.message);
          reject(err);
        } else {
          resolve(value);
        }
      };
      const timer = setTimeout(() => finish(new Error('Outlook did not answer in time')), TIMEOUT_MS);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > MAX_OUTPUT) finish(new Error('Too much output from Outlook'));
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      child.on('error', (err) => finish(err));
      child.on('close', (code) => {
        if (code !== 0) return finish(new Error(`PowerShell exited (${code}) ${stderr.trim()}`.trim()));
        try {
          finish(null, parseOutlookOutput(stdout));
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }
}
