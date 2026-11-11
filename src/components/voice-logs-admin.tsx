import { useEffect, useState } from "react";
import { listVoiceLogs } from "@/lib/voice-log.functions";
import type { VoiceLogEvent } from "@/lib/voice-log-events";

type Advisor = { id: number; name: string; slug: string };
type Session = { id: number; sessionKey: string; sentText: string; createdAt: string; events: VoiceLogEvent[] };

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function heard(event: VoiceLogEvent) {
  const lines = (event.results || []).map((piece) => `${piece.isFinal ? "final" : "interim"}: ${piece.transcript}`);
  if (event.error) lines.push(event.error);
  return lines.join("\n");
}

export function VoiceLogsAdmin({ code }: { code: string }) {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [advisorId, setAdvisorId] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [note, setNote] = useState("");

  async function load(next = advisorId) {
    const result = await listVoiceLogs({ data: { code, advisorId: next || undefined } });
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setNote("");
    setAdvisors(result.advisors);
    setAdvisorId(result.advisorId);
    setSessions(result.sessions);
  }

  useEffect(() => {
    void load(0);
  }, [code]);

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Voice logs</h1>
      <p style={{ color: "#5a6a7a", marginBottom: 16 }}>The last 20 voice sessions for one advisor, newest first. This is what Chrome delivered, plus the text sent to the assistant.</p>
      <label style={{ display: "grid", gap: 6, maxWidth: 360, fontWeight: 700 }}>
        Advisor
        <select value={advisorId || ""} onChange={(event) => { const id = Number(event.target.value); setAdvisorId(id); void load(id); }} style={{ fontWeight: 500, padding: 8 }}>
          {advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>{advisor.name || advisor.slug}</option>)}
        </select>
      </label>
      {note && <p style={{ color: "#b42318", fontWeight: 700 }}>{note}</p>}
      {sessions.length === 0 && <p style={{ color: "#5a6a7a", marginTop: 16 }}>No voice sessions yet for this advisor.</p>}
      <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
        {sessions.map((session) => (
          <article key={session.id} style={{ border: "1px solid #e1e8ef", borderRadius: 10, padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{when(session.createdAt)}</p>
            <p style={{ margin: "6px 0 10px", color: "#16324f" }}><strong>Sent to the assistant:</strong> {session.sentText || "Not sent"}</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#5a6a7a" }}>
                    <th style={{ padding: "4px 8px" }}>Time</th>
                    <th style={{ padding: "4px 8px" }}>Event</th>
                    <th style={{ padding: "4px 8px" }}>Index</th>
                    <th style={{ padding: "4px 8px" }}>Chrome results</th>
                  </tr>
                </thead>
                <tbody>
                  {session.events.map((event, index) => (
                    <tr key={`${session.id}-${index}`} style={{ borderTop: "1px solid #e1e8ef", verticalAlign: "top" }}>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{when(event.at)}</td>
                      <td style={{ padding: "6px 8px" }}>{event.type}</td>
                      <td style={{ padding: "6px 8px" }}>{event.resultIndex ?? ""}</td>
                      <td style={{ padding: "6px 8px", whiteSpace: "pre-wrap" }}>{heard(event)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
