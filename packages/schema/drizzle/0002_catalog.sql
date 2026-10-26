CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`muscle_primary` text NOT NULL,
	`muscles_secondary_json` text NOT NULL,
	`equipment` text NOT NULL,
	`tracking` text NOT NULL,
	`level` text NOT NULL,
	`instructions_json` text NOT NULL,
	`image_keys_json` text NOT NULL,
	`sides` text NOT NULL,
	`default_hold_s` integer,
	`aliases_json` text NOT NULL,
	`search_text` text NOT NULL,
	`origin` text NOT NULL,
	`source_ref` text,
	`data_version` text,
	`note` text,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_slug` ON `exercises` (`slug`);--> statement-breakpoint
CREATE INDEX `exercises_kind` ON `exercises` (`kind`,`hidden`);--> statement-breakpoint
CREATE TABLE `strength_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`set_idx` integer NOT NULL,
	`type` text DEFAULT 'normal' NOT NULL,
	`reps` integer NOT NULL,
	`weight_kg` real,
	`duration_s` integer,
	`completed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `strength_sets_session` ON `strength_sets` (`session_id`);--> statement-breakpoint
CREATE INDEX `strength_sets_exercise` ON `strength_sets` (`exercise_id`,`completed_at`);--> statement-breakpoint
ALTER TABLE `routines` ADD `starter_slug` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `routine_id` text;