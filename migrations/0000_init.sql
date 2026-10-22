CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner` text DEFAULT 'shared' NOT NULL,
	`cover_item_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cover_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `collections_owner_idx` ON `collections` (`owner`);--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_tags_tag_idx` ON `item_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner` text DEFAULT 'shared' NOT NULL,
	`collection_id` text,
	`caption` text DEFAULT '' NOT NULL,
	`tag_text` text DEFAULT '' NOT NULL,
	`source_url` text,
	`tweet_id` text,
	`tweet_url` text,
	`tweet_text` text,
	`author_name` text,
	`author_handle` text,
	`posted_at` text,
	`quote` text,
	`fetch_state` text DEFAULT 'none' NOT NULL,
	`fetch_error` text,
	`fetched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `items_created_idx` ON `items` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `items_collection_idx` ON `items` (`collection_id`);--> statement-breakpoint
CREATE INDEX `items_owner_idx` ON `items` (`owner`);--> statement-breakpoint
CREATE INDEX `items_tweet_idx` ON `items` (`tweet_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`mime` text,
	`path` text,
	`thumb_path` text,
	`width` integer,
	`height` integer,
	`bytes` integer,
	`duration_ms` integer,
	`alt` text,
	`remote_url` text,
	`poster_url` text,
	`mirror_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_item_idx` ON `media` (`item_id`,`position`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
