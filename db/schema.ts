import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const marketSnapshots=sqliteTable('market_snapshots',{
 key:text('key').primaryKey(),body:text('body').notNull(),observedAt:integer('observed_at').notNull(),
});
export const marketProviders=sqliteTable('market_providers',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),leaseUntil:integer('lease_until').notNull(),retryAfter:integer('retry_after').notNull().default(0),lastError:text('last_error'),
});

export const marketRefreshQueue=sqliteTable('market_refresh_queue',{
 key:text('key').primaryKey(),provider:text('provider').notNull(),requestedAt:integer('requested_at').notNull(),ttl:integer('ttl').notNull(),
});
