const DEFAULT_OPERATOR_PASSWORD = "superadmin";

export function normalizeOperatorPassword(value: string) {
  return String(value ?? "").normalize("NFC").trim();
}

export function privateOperatorPassword(value: string) {
  const password = normalizeOperatorPassword(value);
  if (password.toLowerCase() === DEFAULT_OPERATOR_PASSWORD) return "The default password cannot be used.";
  if (password.length < 8) return "Use at least 8 characters.";
  return "";
}
