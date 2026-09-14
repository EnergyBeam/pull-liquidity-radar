CREATE TABLE `market_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`lease_until` integer NOT NULL,
	`retry_after` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `market_refresh_queue` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`requested_at` integer NOT NULL,
	`ttl` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`observed_at` integer NOT NULL
);
