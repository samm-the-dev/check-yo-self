/** Records a daily coaching conversation */
export interface CheckIn {
  /** GUID */
  id: string;
  /** ISO date (YYYY-MM-DD) — one per day */
  date: string;
  /** ISO timestamp of creation */
  timestamp: string;
  /** Free-text note from initial message */
  note?: string;
}

/** A single message in a coaching chat thread */
export interface CoachingMessage {
  /** GUID */
  id: string;
  /** Check-in ID this message belongs to */
  checkInId: string;
  /** Who sent this message */
  role: 'user' | 'assistant';
  /** Message content (markdown) */
  content: string;
  /** ISO timestamp */
  timestamp: string;
}
