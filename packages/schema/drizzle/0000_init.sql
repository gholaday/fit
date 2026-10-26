CREATE TABLE `hr_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`max_hr` integer,
	`max_hr_source` text,
	`resting_hr` integer,
	`lthr` integer,
	`age` integer,
	`input_json` text NOT NULL,
	`zones_json` text NOT NULL,
	`is_current` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hr_profiles_current` ON `hr_profiles` (`is_current`);--> statement-breakpoint
CREATE TABLE `pace_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`vdot` real NOT NULL,
	`source` text NOT NULL,
	`source_detail_json` text,
	`is_current` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pace_profiles_current` ON `pace_profiles` (`is_current`);--> statement-breakpoint
CREATE TABLE `plan_events` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`plan_workout_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plan_events_plan` ON `plan_events` (`plan_id`);--> statement-breakpoint
CREATE TABLE `plan_workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`workout_id` text NOT NULL,
	`date` text NOT NULL,
	`original_date` text NOT NULL,
	`week_index` integer NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` integer,
	`manual_minutes` real,
	`manual_distance_m` real,
	`manual_rpe` integer,
	`manual_note` text,
	`skip_reason` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plan_workouts_date` ON `plan_workouts` (`date`);--> statement-breakpoint
CREATE INDEX `plan_workouts_plan` ON `plan_workouts` (`plan_id`,`date`);--> statement-breakpoint
CREATE INDEX `plan_workouts_sync` ON `plan_workouts` (`dirty`,`updated_at`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`preset_id` text NOT NULL,
	`name` text NOT NULL,
	`inputs_json` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plans_status` ON `plans` (`status`);--> statement-breakpoint
CREATE TABLE `quick_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`activity_type` text NOT NULL,
	`minutes` real NOT NULL,
	`distance_m` real,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quick_logs_date` ON `quick_logs` (`date`);--> statement-breakpoint
CREATE TABLE `routine_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`schedule_id` text,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` integer,
	`details_json` text,
	`skip_reason` text,
	`items_done_json` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `routine_completions_date` ON `routine_completions` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `routine_completions_occurrence` ON `routine_completions` (`schedule_id`,`date`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`folder` text,
	`items_json` text NOT NULL,
	`notes` text,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`original_date` text NOT NULL,
	`new_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_overrides_occurrence` ON `schedule_overrides` (`schedule_id`,`original_date`);--> statement-breakpoint
CREATE INDEX `schedule_overrides_new_date` ON `schedule_overrides` (`new_date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`weekday` integer NOT NULL,
	`routine_id` text NOT NULL,
	`slot` text,
	`time` text,
	`reminder` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `weekly_schedule_weekday` ON `weekly_schedule` (`weekday`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`default_mode` text NOT NULL,
	`items_json` text NOT NULL,
	`notes` text,
	`is_template` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
