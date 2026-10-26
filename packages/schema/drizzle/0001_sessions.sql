CREATE TABLE `session_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`idx` integer NOT NULL,
	`step_json` text NOT NULL,
	`started_at_offset_ms` integer NOT NULL,
	`ended_at_offset_ms` integer NOT NULL,
	`active_ms` integer NOT NULL,
	`distance_m` real NOT NULL,
	`avg_pace_s_per_km` real,
	`treadmill_speed_kph` real,
	`skipped` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_steps_session` ON `session_steps` (`session_id`,`idx`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text,
	`plan_workout_id` text,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`elapsed_ms` integer DEFAULT 0 NOT NULL,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`distance_m` real DEFAULT 0 NOT NULL,
	`avg_pace_s_per_km` real,
	`rpe` integer,
	`notes` text,
	`pace_profile_id` text,
	`hr_profile_id` text,
	`player_json` text NOT NULL,
	`summary_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_started` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `sessions_plan_workout` ON `sessions` (`plan_workout_id`);--> statement-breakpoint
CREATE TABLE `track_points` (
	`session_id` text NOT NULL,
	`t_offset_ms` integer NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`alt` real,
	`accuracy` real NOT NULL,
	`speed` real,
	`source` text DEFAULT 'phone' NOT NULL,
	PRIMARY KEY(`session_id`, `t_offset_ms`)
);
