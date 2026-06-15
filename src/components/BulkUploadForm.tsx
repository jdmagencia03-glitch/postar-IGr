"use client";

import { useState } from "react";
import type { InstagramAccount } from "@/lib/types";

interface Props {
  accounts: InstagramAccount[];
}

export function BulkUploadForm({ accounts }: Props) {
  const [files, setFiles] = useState<FileList | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [postsPerDay, setPostsPerDay] = useState(5);
  const [hours, setHours] = useState("9,12,15,18,21");
  const [captionTemplate, setCaptionTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files?.length || !accountId || !startDate) return;

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error ?? "Falha no upload");

      const hourList = hours.split(",").map((h) => parseInt(h.trim(), 10));
      const items = uploadData.urls.map((url: string, i: number) => ({
        media_urls: [url],
        caption: captionTemplate.replace("{n}", String(i + 1)) || undefined,
      }));

      const bulkRes = await fetch("/api/posts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          media_type: "REELS",
          items,
          start_date: new Date(startDate).toISOString(),
          posts_per_day: postsPerDay,
          hours: hourList,
        }),
      });

      const bulkData = await bulkRes.json();
      if (!bulkRes.ok) throw new Error(bulkData.error ?? "Falha no agendamento");

      setResult(`${bulkData.created} posts agendados com sucesso!`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
      <div>
        <label className="mb-2 block text-sm text-zinc-300">Conta Instagram</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.ig_username}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm text-zinc-300">Vídeos (múltiplos)</label>
        <input
          type="file"
          accept="video/*"
          multiple
          onChange={(e) => setFiles(e.target.files)}
          className="w-full text-sm text-zinc-300"
        />
        {files && (
          <p className="mt-2 text-xs text-zinc-400">{files.length} arquivo(s) selecionado(s)</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm text-zinc-300">Data de início</label>
          <input
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
            required
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-zinc-300">Posts por dia</label>
          <input
            type="number"
            min={1}
            max={10}
            value={postsPerDay}
            onChange={(e) => setPostsPerDay(Number(e.target.value))}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm text-zinc-300">
          Horários (separados por vírgula, ex: 9,12,15,18,21)
        </label>
        <input
          type="text"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-zinc-300">
          Legenda padrão (use {"{n}"} para número do post)
        </label>
        <textarea
          value={captionTemplate}
          onChange={(e) => setCaptionTemplate(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
          placeholder="Post #{n} 🎬"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-4 py-3 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Agendando..." : "Agendar em massa"}
      </button>

      {result && <p className="text-sm text-zinc-300">{result}</p>}
    </form>
  );
}
