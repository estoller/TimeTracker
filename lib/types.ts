export interface TimeEntry {
  id: string;
  client: string;
  taskType: string;
  narrative: string;
  duration: number; // in hours, .1 increments
  durationEstimated?: boolean; // true if AI inferred duration from context
}

export interface ParseResult {
  entries: TimeEntry[];
  entryDate?: string; // ISO date if the dictation references a specific day
}

export interface TimeSession {
  id: string;
  date: string; // ISO date
  rawText: string;
  entries: TimeEntry[];
  createdAt: string;
}

export const TASK_TYPES = [
  "Email Review",
  "Drafting",
  "Meeting",
  "Conference Call",
  "Research",
  "Document Review",
  "Court Appearance",
  "Negotiation",
  "Client Counseling",
  "Filing",
  "Travel",
  "Administrative",
  "Other",
] as const;
