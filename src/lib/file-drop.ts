export type NamedFile = { name: string; type: string };

export function fileAllowed(file: NamedFile, accept?: string) {
  const rules = (accept ?? "")
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) => {
    if (rule === "*" || rule === "*/*") return true;
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    if (rule.startsWith(".")) return name.endsWith(rule);
    return type === rule;
  });
}

export function takeDroppedFiles<T extends NamedFile>(
  list: T[],
  options: { accept?: string; multiple?: boolean; max?: number },
) {
  const max = options.max ?? (options.multiple ? 4 : 1);
  return list.filter((file) => fileAllowed(file, options.accept)).slice(0, options.multiple ? max : 1);
}
