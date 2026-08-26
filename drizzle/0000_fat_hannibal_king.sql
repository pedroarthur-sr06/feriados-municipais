CREATE TABLE `candidatos_nao_verificados` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fonte_dataset` text NOT NULL,
	`tipo_sugerido` text NOT NULL,
	`nome` text NOT NULL,
	`descricao_original` text,
	`uf` text(2) NOT NULL,
	`codigo_ibge` integer,
	`municipio_nome_original` text,
	`data` text NOT NULL,
	`status` text DEFAULT 'pendente' NOT NULL,
	`importado_em` text NOT NULL,
	FOREIGN KEY (`codigo_ibge`) REFERENCES `municipios`(`codigo_ibge`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `feriados` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo_feriado_id` integer NOT NULL,
	`nome` text NOT NULL,
	`abrangencia` text NOT NULL,
	`uf` text(2) NOT NULL,
	`codigo_ibge` integer,
	`mes` integer,
	`dia` integer,
	`regra_calculo` text,
	`ano_inicio` integer,
	`ano_fim` integer,
	`fonte_id` integer NOT NULL,
	`autor` text NOT NULL,
	`data_verificacao` text NOT NULL,
	`observacao` text,
	`ativo` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`tipo_feriado_id`) REFERENCES `tipos_feriado`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`codigo_ibge`) REFERENCES `municipios`(`codigo_ibge`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_id`) REFERENCES `fontes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fontes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`descricao` text NOT NULL,
	`url` text,
	`tipo` text NOT NULL,
	`data_publicacao` text
);
--> statement-breakpoint
CREATE TABLE `municipios` (
	`codigo_ibge` integer PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`uf` text(2) NOT NULL,
	`regiao` text NOT NULL,
	`mesorregiao` text,
	`microrregiao` text
);
--> statement-breakpoint
CREATE TABLE `tipos_feriado` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chave` text NOT NULL,
	`nome` text NOT NULL,
	`descricao` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tipos_feriado_chave_unique` ON `tipos_feriado` (`chave`);