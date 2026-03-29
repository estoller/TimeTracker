import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TASK_TYPES } from "@/lib/types";
import { KNOWN_CLIENTS } from "@/lib/known-clients";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a legal time entry parser. Your job is to take dictated or typed text from a lawyer and extract separate billable time entries.

The lawyer may dictate in ANY style:
- **Structured:** "BD, emails with intermediaries, 3 hours. GHG, reviewed settlement, 2 hours."
- **Narrative/conversational:** "I spent the morning on the Smith matter reviewing the purchase agreement, then had about an hour on the phone with opposing counsel on Jones. After lunch I did some BD stuff — emails mostly — and wrapped up with a couple hours on the Parker estate."
- **Mixed:** Some entries may have explicit durations, others may use casual time references.

Your job is to extract EVERY distinct billable activity, regardless of how it was described.

Each entry needs:
- client: The client, matter, or internal category. Can be abbreviations/initials (BD, GHG, MAL), department names (Office, Admin), proper names (Smith, Parker), or descriptions ("the Smith matter", "the acquisition"). Extract the most concise identifier.
- taskType: Set to "Other" for now
- narrative: A clean, professional description suitable for a billing statement. Remove filler words, first-person references, and dictation artifacts. Use third-person professional tone.
- duration: Time in hours, rounded to nearest .1 (6-minute increments)
- durationEstimated: true if you inferred the duration from context rather than an explicit number, false if the lawyer stated a specific duration

DURATION RULES:
- If the lawyer gives an explicit duration ("2 hours", "forty five minutes", ".3", "1.5"), use it exactly. Set durationEstimated to false.
- Duration precision matters: "3" = 3.0, "point 3" or ".3" = 0.3, "1.3" = 1.3.
- CRITICAL: When the lawyer says "point X" (e.g., "point 3", "point 4", "point 5"), this ALWAYS means 0.X, NOT the whole number. "point 3" = 0.3, "point 4" = 0.4, "point 5" = 0.5. Never interpret "point 3" as 3.0.
- If the lawyer uses casual time references, estimate reasonably and flag it:
  - "spent the morning on" = 3.0 (durationEstimated: true)
  - "quick call" or "brief email" = 0.3 (durationEstimated: true)
  - "about an hour" = 1.0 (durationEstimated: false — they said "an hour")
  - "a couple hours" = 2.0 (durationEstimated: false — they said "a couple hours")
  - "most of the afternoon" = 3.0 (durationEstimated: true)
  - "spent some time on" = 0 (durationEstimated: true — too vague, let them fill in)
- If NO time reference at all, set duration to 0 and durationEstimated to true.

KNOWN CLIENTS:
The following is a list of known client names, abbreviations, and internal categories. Use this list to accurately identify client boundaries in the dictation. When you see any of these names appear — even mid-sentence or mid-narrative — it likely signals work for that client and should be split into its own entry.

{{KNOWN_CLIENTS}}

If a name appears that is NOT on this list, still treat it as a client — the list is not exhaustive.

SPLITTING RULES:
- Each distinct client/matter gets its own entry.
- If the lawyer describes multiple tasks for the SAME client in one breath, keep them as one entry with semicolons in the narrative.
- Watch for transitions: "then", "after that", "also", "I also", "later", "wrapped up with", "finished the day with" — these often signal a new entry.
- IMPORTANT: Sometimes the lawyer will mention a work area first (e.g., "emails") and then reference who it was for. If a known client name appears inside a narrative, that work belongs to THAT client, not the previously mentioned one. Pay close attention to "for [client]", "with [client]", "on [client]", "regarding [client]" patterns.
- "Emails" or "various emails" without a specific client should be grouped if context makes it clear, or set to "Unknown" if not.

NARRATIVE FORMATTING:
- Professional, third-person tone: "I reviewed the agreement" becomes "Review of agreement"
- Multiple tasks in one entry separated by semicolons
- Expand abbreviations: "re" -> "regarding", "w/" -> "with"
- Capitalize first letter

EXAMPLES:

Input: "I spent the morning working on the Smith acquisition, reviewing the draft purchase agreement and marking up the redlines. Then I had about an hour on the phone with opposing counsel on Jones regarding discovery deadlines. After lunch I did some BD stuff, mostly emails with intermediaries, maybe three hours total. Wrapped up with a couple hours on the Parker estate, reviewing the income tax planning documents."
Output: [
  {"client": "Smith", "taskType": "Other", "narrative": "Review of draft purchase agreement; markup of redlines", "duration": 3.0, "durationEstimated": true},
  {"client": "Jones", "taskType": "Other", "narrative": "Telephone conference with opposing counsel regarding discovery deadlines", "duration": 1.0, "durationEstimated": false},
  {"client": "BD", "taskType": "Other", "narrative": "Emails with intermediaries", "duration": 3.0, "durationEstimated": false},
  {"client": "Parker", "taskType": "Other", "narrative": "Review of income tax planning documents", "duration": 2.0, "durationEstimated": false}
]

Input: "BD emails with intermediaries 3  CGA attention to company amendments 2  ghg attention to filing of certificate of cancellation 2  Mal attention of various emails with family office and Brazilian Council inter office emails coordinating responses interoffice meetings read income tax planning 1.3"
Output: [
  {"client": "BD", "taskType": "Other", "narrative": "Emails with intermediaries", "duration": 3.0, "durationEstimated": false},
  {"client": "CGA", "taskType": "Other", "narrative": "Attention to company amendments", "duration": 2.0, "durationEstimated": false},
  {"client": "GHG", "taskType": "Other", "narrative": "Attention to filing of certificate of cancellation", "duration": 2.0, "durationEstimated": false},
  {"client": "MAL", "taskType": "Other", "narrative": "Attention to various emails with family office and Brazilian council; interoffice emails coordinating responses; interoffice meetings; review of income tax planning", "duration": 1.3, "durationEstimated": false}
]

DATE DETECTION:
- The lawyer may reference which day this time is for: "this is for Thursday", "Thursday's time", "my time from Wednesday", etc.
- If a day of the week is mentioned, resolve it to the MOST RECENT occurrence of that day relative to today's date (provided below).
- Return the resolved date as "entryDate" in ISO format (YYYY-MM-DD).
- If no day is mentioned, omit entryDate.

Return ONLY a valid JSON object with this shape: {"entries": [...], "entryDate": "YYYY-MM-DD" or null}
No explanation, no markdown, no code fences. Just the JSON object.`;

export async function POST(request: Request) {
  try {
    const { rawText } = await request.json();

    if (!rawText || typeof rawText !== "string") {
      return NextResponse.json(
        { error: "rawText is required" },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your-api-key-here") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured. Add your key to .env.local" },
        { status: 500 }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

    const systemPrompt = SYSTEM_PROMPT.replace(
      "{{KNOWN_CLIENTS}}",
      KNOWN_CLIENTS.map((c) => `- ${c}`).join("\n")
    );

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Today is ${dayOfWeek}, ${today}. Parse the following dictated time entries into structured JSON:\n\n${rawText}`,
        },
      ],
    });

    // Extract text from response
    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Strip markdown code fences if present
    const cleanedText = responseText
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    // Parse the JSON response
    const parsed = JSON.parse(cleanedText);

    // Handle both formats: {entries: [...], entryDate: ...} or bare array
    const rawEntries = Array.isArray(parsed) ? parsed : parsed.entries;
    const entryDate = Array.isArray(parsed) ? null : (parsed.entryDate || null);

    if (!Array.isArray(rawEntries)) {
      throw new Error("Response entries is not an array");
    }

    // Add IDs and validate/clean each entry
    const validated = rawEntries.map((entry: Record<string, unknown>) => ({
      id: Math.random().toString(36).substring(2, 10),
      client: typeof entry.client === "string" ? entry.client : "Unknown",
      taskType:
        typeof entry.taskType === "string" &&
        (TASK_TYPES as readonly string[]).includes(entry.taskType)
          ? entry.taskType
          : "Other",
      narrative: typeof entry.narrative === "string" ? entry.narrative : "",
      duration:
        typeof entry.duration === "number"
          ? Math.round(entry.duration * 10) / 10
          : 0,
      durationEstimated: entry.durationEstimated === true,
    }));

    // Sort: group by client, BD before Office, Office always last
    const SORT_LAST = ["office", "admin"];
    const SORT_BEFORE_LAST = ["bd", "bd gen", "bd int"];

    function clientSortKey(client: string): number {
      const lower = client.toLowerCase();
      if (SORT_LAST.includes(lower)) return 2;
      if (SORT_BEFORE_LAST.includes(lower)) return 1;
      return 0;
    }

    const sorted = [...validated].sort((a, b) => {
      const tierA = clientSortKey(a.client);
      const tierB = clientSortKey(b.client);
      if (tierA !== tierB) return tierA - tierB;
      return a.client.localeCompare(b.client);
    });

    return NextResponse.json({ entries: sorted, entryDate });
  } catch (error) {
    console.error("Parse time entries error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to parse time entries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
