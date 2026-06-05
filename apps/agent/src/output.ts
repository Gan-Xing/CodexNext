export function printLine(message = ""): void {
  process.stdout.write(`${message}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function printSection(label: string, message?: string): void {
  printLine(message ? `[${label}] ${message}` : `[${label}]`);
}

export function printJson(label: string, value: unknown): void {
  printSection(label, safeJson(value));
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

