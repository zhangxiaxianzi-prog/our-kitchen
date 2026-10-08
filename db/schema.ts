import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
// 每个共同口令对应一份厨房记录；版本号防止两个人同时修改时覆盖对方。
export const kitchens = sqliteTable('kitchens', {id:text('id').primaryKey(),version:integer('version').notNull(),state:text('state').notNull()});
// 登录次数按15分钟分组，用来限制反复猜口令；过时的计数会删除。
export const loginAttempts = sqliteTable('login_attempts', {id:text('id').primaryKey(),bucket:integer('bucket').notNull(),count:integer('count').notNull()}, table => [index('login_attempts_bucket_idx').on(table.bucket)]);
