export type SpeechPiece = { transcript?: string; isFinal?: boolean };

export type UtteranceState = { finals: string[] };

export function emptyUtterance(): UtteranceState {
  return { finals: [] };
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function applySpeechSegments(state: UtteranceState, results: SpeechPiece[], resultIndex = 0) {
  const finals = state.finals.slice();
  let interim = "";
  const start = Number.isInteger(resultIndex) && resultIndex > 0 ? resultIndex : 0;
  for (let index = start; index < results.length; index += 1) {
    const piece = results[index];
    const said = clean(String(piece?.transcript || ""));
    if (piece?.isFinal) {
      if (!said) continue;
      if (index < finals.length) continue;
      finals.push(said);
      continue;
    }
    if (said) interim = clean(`${interim} ${said}`);
  }
  const onlyLatest = start === 0 && results.length === 1 && Boolean(results[0]?.isFinal);
  if (onlyLatest) {
    const said = clean(String(results[0]?.transcript || ""));
    const kept = finals[finals.length - 1] === said || state.finals[state.finals.length - 1] === said;
    if (said && state.finals.length > 0 && !kept && finals.length === state.finals.length) finals.push(said);
  }
  const text = clean([finals.join(" "), interim].filter(Boolean).join(" "));
  return { finals, interim, text };
}

export function keepUtterance(accumulated: string, server: string) {
  const full = clean(accumulated);
  const heard = clean(server);
  if (!heard) return full;
  if (!full) return heard;
  const first = full.split(" ").slice(0, 3).join(" ").toLowerCase();
  if (first && heard.toLowerCase().includes(first)) return heard;
  if (heard.length >= full.length) return heard;
  return full;
}
