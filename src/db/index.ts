import Dexie, { type EntityTable } from 'dexie';
import type { YnabCache } from '@/types/ynab-cache';
import type { CheckIn } from '@/types/check-in';

const db = new Dexie('check-yo-self') as Dexie & {
  cache: EntityTable<YnabCache, 'key'>;
  checkIns: EntityTable<CheckIn, 'id'>;
};

db.version(1).stores({
  cache: 'key',
  checkIns: 'id, date, type',
});

export { db };
