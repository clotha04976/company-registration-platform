CREATE TABLE `cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`summary` text NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'ongoing' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`bonus_twd` integer DEFAULT 500 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_name_unique` ON `employees` (`name`);