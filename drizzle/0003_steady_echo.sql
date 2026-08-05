CREATE TABLE `case_approval_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` integer NOT NULL,
	`agency` text NOT NULL,
	`status` text DEFAULT 'not_received' NOT NULL,
	`approval_date` text,
	`document_number` text,
	`cloud_path` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `case_approval_documents_case_agency_unique` ON `case_approval_documents` (`case_id`,`agency`);--> statement-breakpoint
CREATE INDEX `case_approval_documents_case_status_idx` ON `case_approval_documents` (`case_id`,`status`);--> statement-breakpoint
CREATE TABLE `registration_card_tracking` (
	`case_id` integer PRIMARY KEY NOT NULL,
	`original_received` integer DEFAULT false NOT NULL,
	`customer_copy_sent` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DELETE FROM `case_approval_documents`;
--> statement-breakpoint
DELETE FROM `registration_card_tracking`;
--> statement-breakpoint
DELETE FROM `cases`;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` IN ('cases', 'case_approval_documents');
--> statement-breakpoint
PRAGMA optimize;
