import Dexie, { type EntityTable } from 'dexie';
import type { YnabCache } from '@/types/ynab-cache';
import type { CheckIn, CoachingMessage } from '@/types/check-in';

const db = new Dexie('check-yo-self') as Dexie & {
  cache: EntityTable<YnabCache, 'key'>;
  checkIns: EntityTable<CheckIn, 'id'>;
  coachingMessages: EntityTable<CoachingMessage, 'id'>;
};

db.version(1).stores({
  cache: 'key',
  checkIns: 'id, date, type',
});

db.version(2).stores({
  cache: 'key',
  checkIns: 'id, date, type',
  coachingMessages: 'id, checkInId',
});

db.version(3).stores({
  cache: 'key',
  checkIns: 'id, date',
  coachingMessages: 'id, checkInId',
});

export { db };
