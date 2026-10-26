ALTER TABLE `sessions` ADD `kind` text DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `stats_json` text;--> statement-breakpoint
UPDATE `sessions` SET `kind` = 'strength' WHERE `summary_json` LIKE '%"volumeKg"%';
