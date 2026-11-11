export type DripStep = { title: string; body: string };

export const DRIP_INTERVALS = [
  [1, "Every day"],
  [2, "Every 2 days"],
  [3, "Every 3 days"],
  [4, "Every 4 days"],
  [5, "Every 5 days"],
  [6, "Every 6 days"],
  [7, "Every week"],
  [14, "Every 2 weeks"],
  [30, "Every month"],
] as const;

export function dripLabel(days: number) {
  return DRIP_INTERVALS.find((item) => item[0] === days)?.[1] ?? `Every ${days} days`;
}

export function cleanSteps(value: unknown): DripStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map((item) => {
      const step = item && typeof item === "object" ? (item as { title?: unknown; body?: unknown }) : {};
      return {
        title: String(step.title ?? "").trim().slice(0, 140),
        body: String(step.body ?? "").trim().slice(0, 4000),
      };
    })
    .filter((step) => true);
}

export function packDrip(steps: DripStep[], everyDays: number, design = "plum") {
  return JSON.stringify({ steps: cleanSteps(steps), everyDays, design });
}

export function readDripPack(raw: string): { steps: DripStep[]; everyDays: number } | null {
  try {
    const parsed = JSON.parse(raw) as { steps?: unknown; everyDays?: unknown };
    const steps = cleanSteps(parsed.steps);
    const everyDays = DRIP_INTERVALS.some((item) => item[0] === Number(parsed.everyDays)) ? Number(parsed.everyDays) : 7;
    const design = typeof parsed.design === "string" ? parsed.design : "plum";
    if (steps.length === 0) return null;
    return { steps, everyDays, design };
  } catch {
    return null;
  }
}
