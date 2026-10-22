CREATE TABLE `zipline_ignored` (
	`zipline_id` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `media` ADD `zipline_id` text;--> statement-breakpoint
ALTER TABLE `media` ADD `zipline_name` text;--> statement-breakpoint
ALTER TABLE `media` ADD `zipline_gone_at` text;--> statement-breakpoint
ALTER TABLE `media` ADD `keep_local` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `storage_note` text;--> statement-breakpoint
CREATE INDEX `media_zipline_idx` ON `media` (`zipline_id`);