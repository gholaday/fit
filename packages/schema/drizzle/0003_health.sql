CREATE TABLE `daily_metrics` (
	`date` text PRIMARY KEY NOT NULL,
	`steps` integer,
	`resting_hr` integer,
	`active_kcal` real,
	`sleep_min` integer,
	`source` text NOT NULL,
	`synced_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `external_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`hc_record_id` text NOT NULL,
	`origin_package` text NOT NULL,
	`activity` text NOT NULL,
	`title` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`distance_m` real,
	`active_kcal` real,
	`avg_hr` integer,
	`max_hr` integer,
	`has_route` integer DEFAULT false NOT NULL,
	`rpe` integer,
	`note` text,
	`status` text NOT NULL,
	`linked_session_id` text,
	`linked_plan_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_sessions_hc` ON `external_sessions` (`hc_record_id`);--> statement-breakpoint
CREATE INDEX `external_sessions_status` ON `external_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `external_sessions_started` ON `external_sessions` (`started_at`);--> statement-breakpoint
CREATE TABLE `hc_sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`changes_token` text,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `hr_samples` (
	`session_id` text NOT NULL,
	`t_offset_ms` integer NOT NULL,
	`bpm` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`session_id`, `source`, `t_offset_ms`)
);
--> statement-breakpoint
ALTER TABLE `plan_workouts` ADD `external_session_id` text;--> statement-breakpoint
ALTER TABLE `routine_completions` ADD `external_session_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `hr_filled_at` integer;