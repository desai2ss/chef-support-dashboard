"use client";

import { useEffect, useState } from "react";

type Customer = { id: string; name: string; weeklyHoursExpected: number };
type ModuleRow = { id: string; customerId: string; name: string; status: "on-track" | "at-risk" | "blocked" | "down" };
type Note = { date: string; knownDownText: string; updatedAt: string | null; updatedBy: string | null };

type Props = {
  editor: boolean;
  customers: Customer[];
  modules: ModuleRow[];
  note: Note | null;
  onChange: () => void;
};

const STATUSES = ["on-track", "at-risk", "blocked", "down"] as const;

export default function ManualEntry({ editor, customers, modules, note, onChange }: Props) {
  const [newCust, setNewCust] = useState("");
  const [newModName, setNewModName] = useState("");
  const [newModCust, setNewModCust] = useState("");
  const [newModStatus, setNewModStatus] = useState<typeof STATUSES[number]>("on-track");
  const [noteDraft, setNoteDraft] = useState(note?.knownDownText ?? "");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => { setNoteDraft(note?.knownDownText ?? ""); }, [note?.knownDownText]);
  useEffect(() => { if (!newModCust && customers[0]) setNewModCust(customers[0].id); }, [customers, newModCust]);

  const addCustomer = async () => {
    if (!newCust.trim()) return;
    await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCust.trim(), weeklyHoursExpected: 0 }) });
    setNewCust("");
    onChange();
  };
  const updateCustomer = async (id: string, patch: Partial<Customer>) => {
    await fetch(`/api/customers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    onChange();
  };
  const deleteCustomer = async (id: string) => {
    if (!confirm("Delete this customer and all its modules?")) return;
    await fetch(`/api/customers/${id}`, { method: "DELETE" });
    onChange();
  };
  const addModule = async () => {
    if (!newModName.trim() || !newModCust) return;
    await fetch("/api/modules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: newModCust, name: newModName.trim(), status: newModStatus }) });
    setNewModName("");
    onChange();
  };
  const updateModule = async (id: string, patch: Partial<ModuleRow>) => {
    await fetch(`/api/modules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    onChange();
  };
  const deleteModule = async (id: string) => {
    await fetch(`/api/modules/${id}`, { method: "DELETE" });
    onChange();
  };
  const saveNote = async () => {
    setSavingNote(true);
    await fetch("/api/daily-note", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ knownDownText: noteDraft }) });
    setSavingNote(false);
    onChange();
  };

  return (
    <section className="card mb-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">Team input · Status, weekly hours, known-down</h2>
          <div className="text-xs text-muted mt-1">Shared across the team. {editor ? "You can edit." : "Read-only — ask an editor."}</div>
        </div>
        <span className={"pill " + (editor ? "pill-live" : "pill-readonly")}>{editor ? "Editor" : "Read-only"}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2">Customers &amp; weekly hours expected</div>
          {customers.length === 0 ? (
            <div className="text-muted text-sm italic mb-2">No customers yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-muted">
                  <th className="text-left py-1">Customer</th>
                  <th className="text-left py-1 w-28">Hours / week</th>
                  <th className="text-left py-1 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-1.5">
                      <input className="input" defaultValue={c.name} disabled={!editor}
                        onBlur={(e) => editor && e.target.value !== c.name && updateCustomer(c.id, { name: e.target.value })} />
                    </td>
                    <td className="py-1.5">
                      <input type="number" min={0} step={1} className="input" defaultValue={c.weeklyHoursExpected} disabled={!editor}
                        onBlur={(e) => editor && Number(e.target.value) !== c.weeklyHoursExpected && updateCustomer(c.id, { weeklyHoursExpected: Number(e.target.value) })} />
                    </td>
                    <td className="py-1.5">
                      {editor && <button className="btn-danger" onClick={() => deleteCustomer(c.id)}>×</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editor && (
            <div className="flex gap-2 mt-2">
              <input className="input max-w-[240px]" placeholder="Add customer name…" value={newCust} onChange={(e) => setNewCust(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomer()} />
              <button className="btn" onClick={addCustomer}>Add customer</button>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2">Modules &amp; status</div>
          {modules.length === 0 ? (
            <div className="text-muted text-sm italic mb-2">No modules yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-muted">
                  <th className="text-left py-1">Customer</th>
                  <th className="text-left py-1">Module</th>
                  <th className="text-left py-1 w-32">Status</th>
                  <th className="text-left py-1 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => {
                  const cust = customers.find((c) => c.id === m.customerId);
                  return (
                    <tr key={m.id} className="border-t border-line">
                      <td className="py-1.5 text-muted">{cust?.name ?? "—"}</td>
                      <td className="py-1.5">
                        <input className="input" defaultValue={m.name} disabled={!editor}
                          onBlur={(e) => editor && e.target.value !== m.name && updateModule(m.id, { name: e.target.value })} />
                      </td>
                      <td className="py-1.5">
                        <select className="input" defaultValue={m.status} disabled={!editor}
                          onChange={(e) => editor && updateModule(m.id, { status: e.target.value as any })}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5">
                        {editor && <button className="btn-danger" onClick={() => deleteModule(m.id)}>×</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {editor && (
            <div className="flex flex-wrap gap-2 mt-2">
              <select className="input max-w-[180px]" value={newModCust} onChange={(e) => setNewModCust(e.target.value)}>
                {customers.length === 0 && <option value="">— add a customer first —</option>}
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="input max-w-[160px]" placeholder="Module / SN…" value={newModName} onChange={(e) => setNewModName(e.target.value)} />
              <select className="input max-w-[140px]" value={newModStatus} onChange={(e) => setNewModStatus(e.target.value as any)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn" onClick={addModule}>Add module</button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-wider mb-2">Known-down · daily note</div>
        <textarea
          className="input min-h-[80px]"
          placeholder={editor ? "Free-form: anything down right now, who's on it, ETA…" : "Read-only."}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          disabled={!editor}
        />
        {editor && (
          <div className="flex gap-2 items-center mt-2">
            <button className="btn" onClick={saveNote} disabled={savingNote}>{savingNote ? "Saving…" : "Save note"}</button>
            <span className="text-xs text-muted">
              {note?.updatedAt ? `Last edit ${new Date(note.updatedAt).toLocaleString()} by ${note.updatedBy ?? "—"}` : "Not saved yet today."}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
