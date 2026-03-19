import Dexie, { type EntityTable } from 'dexie';
import type { YnabCache } from '@/types/ynab-cache';

const db = new Dexie('check-yo-self') as Dexie & {
  cache: EntityTable<YnabCache, 'key'>;
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

// v4: Remove check-in and coaching tables (moved to feature/coaching branch)
db.version(4).stores({
  cache: 'key',
  checkIns: null,
  coachingMessages: null,
});

export { db };
