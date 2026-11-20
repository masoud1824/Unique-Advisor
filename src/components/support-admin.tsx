import { useEffect, useState } from "react";
import { createSupportApiKey, downloadStaffFile, loadSupportDesk, noteStaffTicket, readStaffTicket, replyStaffTicket, saveSupportSettings, updateStaffTicket } from "@/lib/support.functions";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/support";

type Ticket = {
  id: number;
  number: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignee: string;
  advisorName: string;
  advisorEmail: string;
  updatedAt: string;
};
type Message = { id: number; author: string; body: string; at: string; files: { id: number; name: string }[] };

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SupportAdmin({ code }: { code: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [advisor, setAdvisor] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(0);
  const [thread, setThread] = useState<Message[]>([]);
  const [current, setCurrent] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [nextStatus, setNextStatus] = useState("Open");
  const [nextPriority, setNextPriority] = useState("Normal");
  const [error, setError] = useState("");

  async function refresh(next = { status, priority, category, advisor, search }) {
    const result = await loadSupportDesk({ data: { code, ...next } });
    if (result.ok) setTickets(result.tickets);
  }

  useEffect(() => {
    void refresh();
    const number = new URLSearchParams(window.location.search).get("ticket") || "";
    if (number) {
      void readStaffTicket({ data: { code, number } }).then((result) => {
        if (!result.ok) return;
        setOpenId(result.ticket.id);
        setCurrent(result.ticket);
        setThread(result.messages);
        setAssignee(result.ticket.assignee);
        setNextStatus(result.ticket.status);
        setNextPriority(result.ticket.priority);
      });
    }
  }, [code]);

  async function open(id: number) {
    const result = await readStaffTicket({ data: { code, id } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpenId(id);
    setCurrent(result.ticket);
    setThread(result.messages);
    setAssignee(result.ticket.assignee);
    setNextStatus(result.ticket.status);
    setNextPriority(result.ticket.priority);
  }

  async function sendReply() {
    const result = await replyStaffTicket({ data: { code, id: openId, body: reply } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReply("");
    await open(openId);
    await refresh();
  }

  async function sendNote() {
    const result = await noteStaffTicket({ data: { code, id: openId, body: note } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote("");
    await open(openId);
  }

  async function saveTicket() {
    const result = await updateStaffTicket({ data: { code, id: openId, status: nextStatus, priority: nextPriority, assignee } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await open(openId);
    await refresh();
  }

  async function saveFile(fileId: number, name: string) {
    const result = await downloadStaffFile({ data: { code, ticketId: openId, fileId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const link = document.createElement("a");
    link.href = result.data;
    link.download = name;
    link.click();
  }

  return (
    <div>
      <h1 style={{ marginBottom: 12 }}>Tickets</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginBottom: 16 }}>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{TICKET_STATUSES.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option>{TICKET_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{TICKET_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
        <input value={advisor} onChange={(event) => setAdvisor(event.target.value)} placeholder="Advisor" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" />
      </div>
      <button type="button" className="btn-sm btn-primary" style={{ marginBottom: 16 }} onClick={() => void refresh()}>Apply filters</button>
      {error && <p style={{ color: "#b42318", fontWeight: 700 }}>{error}</p>}
      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        {tickets.map((ticket) => (
          <button key={ticket.id} type="button" onClick={() => void open(ticket.id)} style={{ textAlign: "left", background: "#fff", border: "1px solid #e1e8ef", borderRadius: 8, padding: 12 }}>
            <strong>{ticket.number}</strong> · {ticket.subject}
            <div style={{ color: "#5a6a7a", marginTop: 4 }}>{ticket.advisorName || ticket.advisorEmail} · {ticket.status} · {ticket.priority} · {ticket.category} · {when(ticket.updatedAt)}</div>
          </button>
        ))}
        {tickets.length === 0 && <p style={{ color: "#5a6a7a" }}>No tickets match.</p>}
      </div>
      {current && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 20 }}>
          <h2>{current.number} · {current.subject}</h2>
          <p style={{ color: "#5a6a7a" }}>{current.advisorName} · {current.advisorEmail}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, margin: "12px 0" }}>
            <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>{TICKET_STATUSES.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={nextPriority} onChange={(event) => setNextPriority(event.target.value)}>{TICKET_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select>
            <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Assignee" />
            <button type="button" className="btn-sm btn-primary" onClick={() => void saveTicket()}>Save</button>
          </div>
          {thread.map((message) => (
            <div key={message.id} style={{ background: message.author === "note" ? "#fff8e8" : message.author === "admin" ? "#f7f9fc" : "#e8f4fd", borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <strong>{message.author === "note" ? "Internal note" : message.author === "admin" ? "Support" : "Advisor"}</strong>
              <span style={{ color: "#5a6a7a", marginLeft: 8 }}>{when(message.at)}</span>
              <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{message.body}</p>
              {message.files.map((file) => (
                <button key={file.id} type="button" className="btn-sm" style={{ marginTop: 6 }} onClick={() => void saveFile(file.id, file.name)}>{file.name}</button>
              ))}
            </div>
          ))}
          <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply the advisor will see" style={{ minHeight: 80, marginTop: 8 }} />
          <button type="button" className="btn-sm btn-primary" style={{ marginTop: 8 }} onClick={() => void sendReply()}>Send reply</button>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Internal note. The advisor does not see this." style={{ minHeight: 70, marginTop: 12 }} />
          <button type="button" className="btn-sm" style={{ marginTop: 8 }} onClick={() => void sendNote()}>Save internal note</button>
        </div>
      )}
    </div>
  );
}

export function SupportSettings({ code }: { code: string }) {
  const [email, setEmail] = useState("");
  const [webhook, setWebhook] = useState("");
  const [secret, setSecret] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [freshKey, setFreshKey] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    void loadSupportDesk({ data: { code } }).then((result) => {
      if (!result.ok) return;
      setEmail(result.settings.email);
      setWebhook(result.settings.webhook);
      setSecret(result.settings.webhookSecret);
      setHasKey(result.settings.hasApiKey);
    });
  }, [code]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveSupportSettings({ data: { code, email, webhook, webhookSecret: secret } }).then((result) => {
          if (!result.ok) {
            setNote(result.error);
            return;
          }
          setNote("Support settings saved.");
        });
      }}
      style={{ background: "#fff", padding: 28, borderRadius: 12, maxWidth: 560, marginBottom: 20 }}
    >
      <h3 style={{ marginBottom: 8 }}>Support</h3>
      <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Support email</label>
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="support@youradviser.grok.me" style={{ marginBottom: 12 }} />
      <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Support webhook URL</label>
      <input value={webhook} onChange={(event) => setWebhook(event.target.value)} placeholder="https://example.com/hooks/support" style={{ marginBottom: 12 }} />
      <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Webhook secret</label>
      <input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Secret used to sign the webhook" style={{ marginBottom: 12 }} />
      <button type="submit" className="btn-sm btn-primary">Save support settings</button>
      <p style={{ marginTop: 16, color: "#5a6a7a" }}>{hasKey ? "An API key is saved. Generating a new one replaces it." : "No API key yet."}</p>
      <button
        type="button"
        className="btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => {
          void createSupportApiKey({ data: { code } }).then((result) => {
            if (!result.ok) {
              setNote(result.error);
              return;
            }
            setFreshKey(result.key);
            setHasKey(true);
          });
        }}
      >
        Generate API key
      </button>
      {freshKey && <p style={{ marginTop: 12, fontWeight: 800 }}>Copy this key now. It is shown only once: {freshKey}</p>}
      {note && <p style={{ marginTop: 12, color: note.includes("saved") ? "#0d7a4f" : "#b42318" }}>{note}</p>}
      <p style={{ marginTop: 12, color: "#5a6a7a" }}>
        API: send Authorization Bearer with the key. GET /api/support/tickets lists tickets. GET /api/support/ticket?id=1 reads one. POST /api/support/ticket with action reply, note, or update.
      </p>
    </form>
  );
}
