export type BackendLogLevel = "debug" | "info" | "log" | "warn" | "error";

type ConsoleMethod = (...data: unknown[]) => void;

const LOG_LEVEL_LABELS: Record<BackendLogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  log: "INFO",
  warn: "WARN",
  error: "ERROR",
};

let installed = false;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function formatLogPrefix(level: BackendLogLevel, date = new Date()): string {
  const timestamp = [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    ".",
    pad(date.getMilliseconds(), 3),
  ].join("");
  return `[${timestamp}] [${LOG_LEVEL_LABELS[level]}]`;
}

export function installConsoleTimestamp(): void {
  if (installed) return;
  installed = true;

  const mutableConsole = console as Console & Record<BackendLogLevel, ConsoleMethod>;
  for (const level of Object.keys(LOG_LEVEL_LABELS) as BackendLogLevel[]) {
    const original = mutableConsole[level].bind(console);
    mutableConsole[level] = (...data: unknown[]) => {
      original(formatLogPrefix(level), ...data);
    };
  }
}
