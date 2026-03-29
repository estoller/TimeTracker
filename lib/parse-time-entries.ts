import { TimeEntry, ParseResult, TASK_TYPES } from "./types";

// AI-powered parser that calls Claude API to parse dictated time entries.
// Falls back to local pattern matching if the API call fails.

export async function parseTimeEntries(rawText: string): Promise<ParseResult> {
  try {
    const response = await fetch("/api/parse-time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "API request failed");
    }

    const data = await response.json();
    return { entries: data.entries, entryDate: data.entryDate || undefined };
  } catch (error) {
    console.warn("AI parsing failed, falling back to local parser:", error);
    return { entries: parseTimeEntriesLocal(rawText) };
  }
}

// --- Local fallback parser (pattern matching) ---

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

function parseDuration(text: string): number {
  const lower = text.toLowerCase();

  const wordMap: Record<string, number> = {
    "half an hour": 0.5,
    "half hour": 0.5,
    "quarter hour": 0.3,
    "fifteen minutes": 0.3,
    "twenty minutes": 0.3,
    "thirty minutes": 0.5,
    "forty five minutes": 0.8,
    "forty-five minutes": 0.8,
    "45 minutes": 0.8,
    "an hour": 1.0,
    "one hour": 1.0,
    "hour and a half": 1.5,
    "hour and half": 1.5,
    "two hours": 2.0,
    "two and a half hours": 2.5,
    "three hours": 3.0,
    "four hours": 4.0,
    "five hours": 5.0,
  };

  for (const [phrase, hrs] of Object.entries(wordMap)) {
    if (lower.includes(phrase)) return hrs;
  }

  const numMatch = lower.match(/(\d+\.?\d*)\s*(hours?|hrs?)?/);
  if (numMatch) {
    const val = parseFloat(numMatch[1]);
    if (lower.includes("minute")) {
      return roundToTenth(val / 60);
    }
    return roundToTenth(val);
  }

  return 0.5;
}

function guessTaskType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("email") || lower.includes("e-mail") || lower.includes("correspondence")) return "Email Review";
  if (lower.includes("draft") || lower.includes("wrote") || lower.includes("writing")) return "Drafting";
  if (lower.includes("meeting") || lower.includes("met with")) return "Meeting";
  if (lower.includes("call") || lower.includes("conference") || lower.includes("phone")) return "Conference Call";
  if (lower.includes("research") || lower.includes("looked into") || lower.includes("investigated")) return "Research";
  if (lower.includes("review") || lower.includes("reviewed") || lower.includes("read")) return "Document Review";
  if (lower.includes("court") || lower.includes("hearing") || lower.includes("appear")) return "Court Appearance";
  if (lower.includes("negotiat")) return "Negotiation";
  if (lower.includes("counsel") || lower.includes("advise") || lower.includes("advised")) return "Client Counseling";
  if (lower.includes("fil")) return "Filing";
  if (lower.includes("travel")) return "Travel";
  return "Other";
}

function parseTimeEntriesLocal(rawText: string): TimeEntry[] {
  const segments = rawText
    .split(/(?:\.\s+|\n+|;\s*)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  if (segments.length === 0) {
    return [parseSingleEntry(rawText)];
  }

  return segments.map(parseSingleEntry).filter((e) => e.client || e.narrative);
}

function parseSingleEntry(text: string): TimeEntry {
  const trimmed = text.trim().replace(/\.$/, "");

  const parts = trimmed.split(/,\s*/);
  let client = "";
  let remainder = trimmed;

  if (parts.length >= 2) {
    client = parts[0].trim();
    remainder = parts.slice(1).join(", ").trim();
  }

  const duration = parseDuration(remainder);
  const taskType = guessTaskType(remainder);

  let narrative = remainder
    .replace(/\b(about|approximately|around|roughly)?\s*(\d+\.?\d*)\s*(hours?|hrs?|minutes?|mins?)\b/gi, "")
    .replace(/\b(an hour|hour and a half|half an hour|two hours|three hours|four hours|five hours)\b/gi, "")
    .replace(/,\s*$/, "")
    .replace(/^\s*,\s*/, "")
    .trim();

  if (!narrative) narrative = taskType;

  return {
    id: generateId(),
    client,
    taskType,
    narrative,
    duration,
  };
}
