const secretPatterns: Array<[RegExp, string]> = [
  [/\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, "[REDACTED_TOKEN]"],
  [/\b(?:Bearer\s+)[A-Za-z0-9._~+\/-]{12,}=*/gi, "Bearer [REDACTED_TOKEN]"],
  [
    /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]",
  ],
  [
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
    "[REDACTED_PRIVATE_KEY]",
  ],
  [/\bhttps?:\/\/[^\s/]+\/(?:Users|home)\/[^\s]+/gi, "[REDACTED_PATH]"],
  [/(?:^|\s)\/(?:Users|home|private|var|tmp)\/[^\s]+/g, " [REDACTED_PATH]"],
];

export function redact(input: string): string {
  let value = input.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
  for (const [pattern, replacement] of secretPatterns)
    value = value.replace(pattern, replacement);
  return value;
}

export function normalizeText(input: string, maxLength: number): string {
  const compact = redact(input).replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
