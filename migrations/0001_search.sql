-- Full-text search over captions, tweet text, authors, tags and quoted tweets (SQLite FTS5).
-- A plain FTS table keyed by item_id (not an external-content table: items has no integer
-- primary key, and VACUUM may renumber implicit rowids). Triggers keep it in step with items.
CREATE VIRTUAL TABLE `items_fts` USING fts5(
	`item_id` UNINDEXED,
	`caption`,
	`tweet_text`,
	`author`,
	`tags`,
	`quote`,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `items_fts_insert` AFTER INSERT ON `items` BEGIN
	INSERT INTO `items_fts` (`item_id`, `caption`, `tweet_text`, `author`, `tags`, `quote`)
	VALUES (
		new.`id`,
		new.`caption`,
		coalesce(new.`tweet_text`, ''),
		trim(coalesce(new.`author_name`, '') || ' ' || coalesce(new.`author_handle`, '')),
		new.`tag_text`,
		trim(
			coalesce(json_extract(new.`quote`, '$.text'), '') || ' ' ||
			coalesce(json_extract(new.`quote`, '$.authorName'), '') || ' ' ||
			coalesce(json_extract(new.`quote`, '$.authorHandle'), '')
		)
	);
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_delete` AFTER DELETE ON `items` BEGIN
	DELETE FROM `items_fts` WHERE `item_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_update` AFTER UPDATE OF
	`caption`, `tweet_text`, `author_name`, `author_handle`, `tag_text`, `quote`
ON `items` BEGIN
	DELETE FROM `items_fts` WHERE `item_id` = old.`id`;
	INSERT INTO `items_fts` (`item_id`, `caption`, `tweet_text`, `author`, `tags`, `quote`)
	VALUES (
		new.`id`,
		new.`caption`,
		coalesce(new.`tweet_text`, ''),
		trim(coalesce(new.`author_name`, '') || ' ' || coalesce(new.`author_handle`, '')),
		new.`tag_text`,
		trim(
			coalesce(json_extract(new.`quote`, '$.text'), '') || ' ' ||
			coalesce(json_extract(new.`quote`, '$.authorName'), '') || ' ' ||
			coalesce(json_extract(new.`quote`, '$.authorHandle'), '')
		)
	);
END;
