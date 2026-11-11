import { useEffect, useState } from "react";
import { downloadMyFile, loadMyTickets, openMyTicket, readMyTicket, replyMyTicket } from "@/lib/support.functions";
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "@/lib/support";
import { FileDrop } from "@/components/file-drop";

type Ticket = { id: number; number: string; subject: string; category: string; priority: string; status: string; updatedAt: string };
type Message = { id: number; author: string; body: string; at: string; files: { id: number; name: string }[] };

async function readFiles(list: File[]) {
  const files = list.slice(0, 4);
  const out: { name: string; mime: string; data: string }[] = [];
  for (const file of files) {
    if (file.size > 1_200_000) continue;
    const data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
    if (data.startsWith("data:")) out.push({ name: file.name, mime: file.type, data });
  }
  return out;
}

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SupportDesk({ code, slug }: { code: string; slug: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState(0);
  const [thread, setThread] = useState<Message[]>([]);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("Bug");
  const [priority, setPriority] = useState("Normal");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await loadMyTickets({ data: { slug, code } });
    if (result.ok) setTickets(result.tickets);
  }

  useEffect(() => {
    void refresh();
  }, [slug, code]);

  async function open(id: number) {
    setOpenId(id);
    const result = await readMyTicket({ data: { slug, code, id } });
    if (result.ok) setThread(result.messages);
    else setNote(result.error);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote("");
    const result = await openMyTicket({ data: { slug, code, subject, category, priority, description, files: await readFiles(files) } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setSubject("");
    setDescription("");
    setFiles([]);
    setNote(`Ticket ${result.ticket.number} is open.`);
    await refresh();
    await open(result.ticket.id);
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await replyMyTicket({ data: { slug, code, id: openId, body: reply, files: await readFiles(replyFiles) } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setReply("");
    setReplyFiles([]);
    await open(openId);
    await refresh();
  }

  async function saveFile(ticketId: number, fileId: number, name: string) {
    const result = await downloadMyFile({ data: { slug, code, ticketId, fileId } });
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    const link = document.createElement("a");
    link.href = result.data;
    link.download = name;
    link.click();
  }

  const current = tickets.find((ticket) => ticket.id === openId);

  return (
    <div className="grid gap-4">
      <section className="ua-panel p-6">
        <h2 className="text-lg font-semibold">Open a ticket</h2>
        <form onSubmit={(event) => void create(event)} className="mt-3 grid gap-3">
          <input className="ua-field" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" required />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">Category
              <select className="ua-field font-normal" value={category} onChange={(event) => setCategory(event.target.value)}>
                {TICKET_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Priority
              <select className="ua-field font-normal" value={priority} onChange={(event) => setPriority(event.target.value)}>
                {TICKET_PRIORITIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <textarea className="ua-field" rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the problem" required />
          <FileDrop
            label="Upload screenshot"
            accept="image/*,.pdf,.txt"
            multiple
            files={files}
            hint="PNG, JPG, PDF, or text. Up to 4 files, each under 1.2 MB."
            onFiles={(picked) => {
              const big = picked.filter((file) => file.size > 1_200_000);
              if (big.length) setNote(`${big.map((file) => file.name).join(", ")} ${big.length > 1 ? "are" : "is"} too large. Use a file under 1.2 MB.`);
              setFiles((current) => [...current, ...picked.filter((file) => file.size <= 1_200_000)].slice(0, 4));
            }}
            onRemove={(index) => setFiles((current) => current.filter((_, item) => item !== index))}
          />
          <button type="submit" className="ua-btn" style={{ width: "fit-content" }} disabled={busy}>{busy ? "Sending…" : "Open ticket"}</button>
        </form>
        {note && <p className="mt-3 text-sm font-semibold" style={{ color: note.includes("open") ? "#0d7a4f" : "#b42318" }}>{note}</p>}
      </section>
      <section className="ua-panel p-6">
        <h2 className="text-lg font-semibold">Your tickets</h2>
        <div className="mt-3 grid gap-2">
          {tickets.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>No tickets yet.</p>}
          {tickets.map((ticket) => (
            <button key={ticket.id} type="button" className="rounded-lg border px-3 py-3 text-left" style={{ borderColor: "#e1e8ef" }} onClick={() => void open(ticket.id)}>
              <strong>{ticket.number}</strong> · {ticket.subject}
              <span className="mt-1 block text-sm" style={{ color: "#5a6a7a" }}>{ticket.status} · {ticket.priority} · {ticket.category} · {when(ticket.updatedAt)}</span>
            </button>
          ))}
        </div>
      </section>
      {current && (
        <section className="ua-panel p-6">
          <h2 className="text-lg font-semibold">{current.number} · {current.subject}</h2>
          <p className="text-sm" style={{ color: "#5a6a7a" }}>{current.status} · {current.priority}</p>
          <div className="mt-4 grid gap-3">
            {thread.map((message) => (
              <div key={message.id} className="rounded-lg px-4 py-3 text-sm" style={{ background: message.author === "advisor" ? "#e8f4fd" : "#f7f9fc" }}>
                <strong>{message.author === "advisor" ? "You" : "Unique Advisor support"}</strong>
                <span className="ml-2 text-xs" style={{ color: "#5a6a7a" }}>{when(message.at)}</span>
                <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
                {message.files.map((file) => (
                  <button key={file.id} type="button" className="ua-btn-line mt-2" style={{ padding: "4px 8px" }} onClick={() => void saveFile(current.id, file.id, file.name)}>{file.name}</button>
                ))}
              </div>
            ))}
          </div>
          <form onSubmit={(event) => void sendReply(event)} className="mt-4 grid gap-2">
            <textarea className="ua-field" rows={3} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply" />
            <FileDrop
              label="Upload file"
              accept="image/*,.pdf,.txt"
              multiple
              files={replyFiles}
              hint="Or drop a screenshot or file here."
              onFiles={(picked) => {
                const big = picked.filter((file) => file.size > 1_200_000);
                if (big.length) setNote(`${big.map((file) => file.name).join(", ")} ${big.length > 1 ? "are" : "is"} too large. Use a file under 1.2 MB.`);
                setReplyFiles((current) => [...current, ...picked.filter((file) => file.size <= 1_200_000)].slice(0, 4));
              }}
              onRemove={(index) => setReplyFiles((current) => current.filter((_, item) => item !== index))}
            />
            <button type="submit" className="ua-btn" style={{ width: "fit-content" }} disabled={busy}>Send reply</button>
          </form>
        </section>
      )}
    </div>
  );
}
