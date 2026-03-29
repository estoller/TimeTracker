"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { TimeEntry, TimeSession } from "@/lib/types";
import { parseTimeEntries } from "@/lib/parse-time-entries";
import { loadState, saveState } from "@/lib/storage";
import { supabase } from "@/lib/supabase";

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function DurationInput({ initialValue, onCommit, onCancel }: { initialValue: number; onCommit: (val: number) => void; onCancel: () => void }) {
  const [text, setText] = useState(initialValue === 0 ? "" : String(initialValue));
  return (
    <input
      autoFocus
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "" || /^\d*\.?\d*$/.test(v)) setText(v);
      }}
      onBlur={() => onCommit(roundToTenth(Number(text) || 0))}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(roundToTenth(Number(text) || 0));
        if (e.key === "Escape") onCancel();
      }}
      placeholder="0.0"
      className="w-16 bg-background border border-accent/30 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-accent"
    />
  );
}

export default function TimeTracker({ userId }: { userId: string }) {
  const [rawText, setRawText] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [entryDate, setEntryDate] = useState<string | undefined>();
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load sessions from Supabase on mount
  useEffect(() => {
    loadState(userId).then((state) => {
      setSessions(state.sessions);
      setLoaded(true);
    });
  }, [userId]);

  // Debounced save to Supabase on sessions change
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveState(userId, { sessions });
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [sessions, loaded, userId]);

  const startRecording = useCallback(() => {
    const SpeechRecognitionClass =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      alert("Speech recognition is not supported in this browser. Try Chrome.");
      return;
    }

    const recognition = new (SpeechRecognitionClass as new () => SpeechRecognition)();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = rawText;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += (finalTranscript ? " " : "") + result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setRawText(finalTranscript + (interim ? " " + interim : ""));
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [rawText]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  async function handleProcess() {
    if (!rawText.trim() || isProcessing) return;
    setIsProcessing(true);
    try {
      const result = await parseTimeEntries(rawText.trim());
      setEntries(result.entries);
      if (result.entryDate) setEntryDate(result.entryDate);
    } catch (error) {
      console.error("Failed to process entries:", error);
    } finally {
      setIsProcessing(false);
    }
  }

  function getEntryDate(): Date {
    if (entryDate) return new Date(entryDate + "T00:00:00");
    return new Date();
  }

  function handleClear() {
    setRawText("");
    setEntries([]);
    setEntryDate(undefined);
  }

  function updateEntry(id: string, field: keyof TimeEntry, value: string | number) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        if (field === "duration") {
          return { ...e, duration: roundToTenth(Number(value) || 0), durationEstimated: false };
        }
        return { ...e, [field]: value };
      })
    );
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      { id: generateId(), client: "", taskType: "Other", narrative: "", duration: 0.5 },
    ]);
  }

  function handleSaveSession() {
    if (entries.length === 0) return;
    const session: TimeSession = {
      id: generateId(),
      date: entryDate || todayISO(),
      rawText,
      entries: [...entries],
      createdAt: new Date().toISOString(),
    };
    setSessions((prev) => [session, ...prev]);
    setRawText("");
    setEntries([]);
    setEntryDate(undefined);
  }

  function loadSession(session: TimeSession) {
    setRawText(session.rawText);
    setEntries(session.entries);
    setShowHistory(false);
  }

  function deleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function copyToClipboard() {
    const date = getEntryDate();
    const dateStr = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const header = `Time Entries - ${dateStr}\n\n`;
    const columnHeader = "CLIENT / NARRATIVE / HOURS\n\n";
    const lines = entries
      .map(
        (e) =>
          `${e.client} - ${e.narrative}\t${e.duration.toFixed(1)}`
      )
      .join("\n\n");
    const total = entries.reduce((sum, e) => sum + e.duration, 0);
    const text = header + columnHeader + lines + `\n\nTotal: ${total.toFixed(1)} hours`;
    navigator.clipboard.writeText(text);
  }

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Time Entries");

    sheet.getColumn("A").width = 10;
    sheet.getColumn("B").width = 50;
    sheet.getColumn("C").width = 12;
    sheet.getColumn("B").alignment = { wrapText: true, vertical: "top" };

    const date = getEntryDate();
    const dateStr = date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    sheet.getCell("A1").value = "Name:";
    sheet.getCell("A1").font = { bold: true };
    sheet.getCell("B1").value = "Josefina Colomar";
    sheet.getCell("A2").value = "Date:";
    sheet.getCell("A2").font = { bold: true };
    sheet.getCell("B2").value = dateStr;

    const headerRow = sheet.getRow(4);
    headerRow.values = ["Client", "Narrative", "Hours"];
    headerRow.font = { bold: true };

    entries.forEach((e, i) => {
      const row = sheet.getRow(5 + i);
      row.values = [
        e.client,
        e.narrative,
        e.duration === 0 ? "TBD" : e.duration,
      ];
    });

    const totalRowNum = 5 + entries.length + 1;
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.getCell("B").value = "Total";
    totalRow.getCell("B").font = { bold: true };
    totalRow.getCell("C").value = { formula: `SUM(C5:C${5 + entries.length - 1})` } as unknown as number;
    totalRow.getCell("C").font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `time-entries-${todayISO()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalHours = entries.reduce((sum, e) => sum + e.duration, 0);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-muted text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-accent px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">TimeTracker</h1>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            {showHistory ? "Back to Entry" : "History"}
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm text-white/50 hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {showHistory ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Saved Sessions</h2>
            {sessions.length === 0 ? (
              <p className="text-muted text-sm">No saved sessions yet.</p>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-card-bg border border-card-border rounded-xl p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        {new Date(session.date + "T00:00:00").toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                      <span className="text-xs text-muted ml-3">
                        {session.entries.length} entries - {session.entries.reduce((s, e) => s + e.duration, 0).toFixed(1)} hrs
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadSession(session)}
                        className="text-xs text-accent hover:text-accent-light transition-colors"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => deleteSession(session.id)}
                        className="text-xs text-muted hover:text-danger transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {session.entries.map((e) => (
                      <span key={e.id}>
                        <span className="font-medium text-foreground/70">{e.client || "Unknown"}</span>
                        {" "}
                        {e.duration === 0 ? <span className="text-danger">TBD</span> : `${e.duration.toFixed(1)}h`}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            {/* Dictation Area */}
            <div className="bg-card-bg border border-card-border rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                  Dictate Your Time
                </h2>
                <span className="text-xs text-muted">
                  {new Date().toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>

              <div className="relative">
                <textarea
                  ref={textAreaRef}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder='Tap the mic and talk through your day naturally. Example: "I spent the morning on the Smith matter reviewing the purchase agreement, then had about an hour on the phone with opposing counsel on Jones. After lunch I did some BD emails and wrapped up with a couple hours on the Parker estate."'
                  rows={5}
                  className="w-full rounded-lg border border-card-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none"
                />
                {isRecording && (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-danger rounded-full animate-pulse" />
                    <span className="text-xs text-danger font-medium">Recording</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isRecording
                      ? "bg-danger text-white hover:bg-danger/90 shadow-sm"
                      : "bg-accent text-white hover:bg-accent-light shadow-sm"
                  }`}
                >
                  {isRecording ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                      Stop
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                      </svg>
                      Dictate
                    </>
                  )}
                </button>

                <button
                  onClick={handleProcess}
                  disabled={!rawText.trim() || isProcessing}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-light transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm min-w-[100px]"
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    "Process"
                  )}
                </button>

                {rawText && (
                  <button
                    onClick={handleClear}
                    className="text-xs text-muted hover:text-danger transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Review Table */}
            {entries.length > 0 && (
              <div className="bg-card-bg border border-card-border rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                    Review Entries
                  </h2>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold text-foreground">
                      Total: <span className="text-accent">{totalHours.toFixed(1)} hrs</span>
                    </span>
                    <span className="text-xs text-muted">{entries.length} entries</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border bg-background/50">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted w-[160px]">
                          Client / Internal
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted">
                          Narrative
                        </th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted w-[80px]">
                          Hours
                        </th>
                        <th className="w-[40px]" />
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id} className="border-b border-card-border last:border-0 hover:bg-background/30 transition-colors">
                          <td className="px-4 py-2.5">
                            {editingCell?.id === entry.id && editingCell.field === "client" ? (
                              <input
                                autoFocus
                                value={entry.client}
                                onChange={(e) => updateEntry(entry.id, "client", e.target.value)}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => e.key === "Enter" && setEditingCell(null)}
                                className="w-full bg-background border border-accent/30 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            ) : (
                              <span
                                onClick={() => setEditingCell({ id: entry.id, field: "client" })}
                                className="cursor-pointer hover:text-accent transition-colors block py-1"
                              >
                                {entry.client || <span className="text-muted italic">Click to set</span>}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {editingCell?.id === entry.id && editingCell.field === "narrative" ? (
                              <input
                                autoFocus
                                value={entry.narrative}
                                onChange={(e) => updateEntry(entry.id, "narrative", e.target.value)}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => e.key === "Enter" && setEditingCell(null)}
                                className="w-full bg-background border border-accent/30 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            ) : (
                              <span
                                onClick={() => setEditingCell({ id: entry.id, field: "narrative" })}
                                className="cursor-pointer hover:text-accent transition-colors block py-1"
                              >
                                {entry.narrative || <span className="text-muted italic">Click to set</span>}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {editingCell?.id === entry.id && editingCell.field === "duration" ? (
                              <DurationInput
                                initialValue={entry.duration}
                                onCommit={(val) => {
                                  updateEntry(entry.id, "duration", val);
                                  setEditingCell(null);
                                }}
                                onCancel={() => setEditingCell(null)}
                              />
                            ) : (
                              <span
                                onClick={() => setEditingCell({ id: entry.id, field: "duration" })}
                                className={`cursor-pointer transition-colors font-medium ${
                                  entry.duration === 0
                                    ? "text-danger font-semibold"
                                    : entry.durationEstimated
                                    ? "text-yellow-400 hover:text-accent font-mono"
                                    : "hover:text-accent font-mono"
                                }`}
                                title={entry.durationEstimated ? "Estimated - click to adjust" : "Click to edit"}
                              >
                                {entry.duration === 0 ? "TBD" : entry.duration.toFixed(1)}
                                {entry.durationEstimated && entry.duration > 0 && (
                                  <span className="text-[10px] ml-0.5">~</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            <button
                              onClick={() => removeEntry(entry.id)}
                              className="text-muted hover:text-danger transition-colors text-xs"
                            >
                              x
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-background/50">
                        <td colSpan={2} className="px-4 py-2.5">
                          <button
                            onClick={addEntry}
                            className="text-xs text-accent hover:text-accent-light transition-colors"
                          >
                            + Add Entry
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-accent">
                          {totalHours.toFixed(1)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Actions */}
                <div className="px-5 py-4 border-t border-card-border flex items-center gap-3 flex-wrap">
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-light transition-colors shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy to Clipboard
                  </button>
                  <button
                    onClick={exportExcel}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-accent text-accent hover:bg-accent/5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export Excel
                  </button>
                  <button
                    onClick={handleSaveSession}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-success text-success hover:bg-success/5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Save Session
                  </button>
                </div>
              </div>
            )}

            {/* Empty state */}
            {entries.length === 0 && !rawText && (
              <div className="bg-card-bg border border-card-border rounded-xl p-12 text-center shadow-sm">
                <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1">Ready to capture your time</h3>
                <p className="text-sm text-muted max-w-md mx-auto">
                  Tap <strong>Dictate</strong> and talk through your day naturally.
                  Just describe what you worked on - the AI will figure out the clients, tasks, and durations.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
