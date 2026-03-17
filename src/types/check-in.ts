export type CheckInType = 'morning' | 'evening';

/** Records a daily ritual check-in */
export interface CheckIn {
  /** GUID */
  id: string;
  /** ISO date */
  date: string;
  type: CheckInType;
  /** ISO timestamp */
  timestamp: string;
  /** Free-text note */
  note?: string;
  /** Cached coaching response for this check-in */
  coachingInsight?: string;
}
