// Security hardening utilities: prompt-injection defense and token masking.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /system\s+prompt/i,
  /new\s+instructions?\s*:/i,
  /pretend\s+to\s+be/i,
  /reveal\s+your\s+(system\s+)?(prompt|instructions?)/i,
  /developer\s+mode/i,
  /jailbreak/i,
];

/**
 * Returns true if the message attempts to override or extract the system prompt.
 */
export function isInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/**
 * Mask a secret for logs / telemetry. Keeps a short prefix for identification.
 */
export function maskSecret(secret?: string): string {
  if (!secret) return "<unset>";
  const trimmed = secret.trim();
  if (trimmed.length <= 6) return "***";
  const prefix = trimmed.slice(0, 4);
  return `${prefix}${"*".repeat(Math.min(12, trimmed.length - 4))}`;
}
