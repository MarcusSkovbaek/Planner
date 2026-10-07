/*
 * Stand-in for the user32/kernel32 functions used by Win32Provider, with identical
 * signatures. Compiled into a shared library by the unit tests so the koffi
 * declarations and marshalling (out-parameters, UTF-16 buffers) are verified on any OS.
 */
#include <stdint.h>
#include <string.h>
#include <uchar.h>

typedef void *HWND;
typedef void *HANDLE;
typedef uint32_t DWORD;

static int window_token;
static int process_token;
static int foreground_enabled = 1;
static const char16_t TITLE[] = u"Købsaftale – Nordlys.docx - Word";
static const char16_t PATH[] = u"C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE";

static size_t len16(const char16_t *s) {
  size_t n = 0;
  while (s[n]) n++;
  return n;
}

void mock_set_foreground(int enabled) { foreground_enabled = enabled; }

HWND GetForegroundWindow(void) { return foreground_enabled ? &window_token : 0; }

int GetWindowTextLengthW(HWND hwnd) { return hwnd ? (int)len16(TITLE) : 0; }

int GetWindowTextW(HWND hwnd, void *buffer, int max_count) {
  if (!hwnd || max_count <= 0) return 0;
  size_t n = len16(TITLE);
  if (n > (size_t)(max_count - 1)) n = (size_t)(max_count - 1);
  memcpy(buffer, TITLE, n * sizeof(char16_t));
  ((char16_t *)buffer)[n] = 0;
  return (int)n;
}

DWORD GetWindowThreadProcessId(HWND hwnd, DWORD *process_id) {
  if (!hwnd) return 0;
  if (process_id) *process_id = 4242;
  return 77;
}

HANDLE OpenProcess(DWORD access, int inherit, DWORD process_id) {
  (void)access;
  (void)inherit;
  return process_id == 4242 ? &process_token : 0;
}

int QueryFullProcessImageNameW(HANDLE process, DWORD flags, void *buffer, DWORD *size) {
  (void)flags;
  size_t n = len16(PATH);
  if (process != &process_token || !size || *size <= n) return 0;
  memcpy(buffer, PATH, (n + 1) * sizeof(char16_t));
  *size = (DWORD)n;
  return 1;
}

int CloseHandle(HANDLE handle) { return handle != 0; }
