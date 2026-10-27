CREATE TABLE `weigh_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`measured_at` integer NOT NULL,
	`date` text NOT NULL,
	`kg` real NOT NULL,
	`source` text NOT NULL,
	`hc_record_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weigh_ins_hc` ON `weigh_ins` (`hc_record_id`);--> statement-breakpoint
CREATE INDEX `weigh_ins_date` ON `weigh_ins` (`date`);--> statement-breakpoint
CREATE TABLE `weight_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`start_date` text NOT NULL,
	`start_kg` real NOT NULL,
	`target_kg` real NOT NULL,
	`pace_kg_week` real NOT NULL,
	`status` text NOT NULL,
	`reached_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL
);
