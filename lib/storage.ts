import type { TimeSession } from "./types";
import { supabase } from "./supabase";

export interface TTState {
  sessions: TimeSession[];
}

const DEFAULT_STATE: TTState = {
  sessions: [],
};

function parseState(raw: unknown): TTState {
  let parsed: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_STATE;
    }
  } else {
    parsed = (raw ?? {}) as Record<string, unknown>;
  }

  return {
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  };
}

export async function loadState(userId: string): Promise<TTState> {
  try {
    const { data, error } = await supabase
      .from("tt_user_state")
      .select("state")
      .eq("user_id", userId)
      .single();

    if (error || !data) return DEFAULT_STATE;
    return parseState(data.state);
  } catch {
    return DEFAULT_STATE;
  }
}

export async function saveState(userId: string, state: TTState): Promise<void> {
  try {
    await supabase
      .from("tt_user_state")
      .upsert(
        { user_id: userId, state, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
  } catch {
    // Silently fail — will retry on next state change
  }
}
