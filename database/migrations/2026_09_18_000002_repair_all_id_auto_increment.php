<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * yearbook_db dump restored without AUTO_INCREMENT / PRIMARY KEY on many `id` columns.
 * Repair all integer-like id columns so inserts (register, tokens, OTP, feed, etc.) work.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::getConnection()->getDriverName() !== 'mysql') {
            return;
        }

        $tables = DB::select(
            "SELECT TABLE_NAME, COLUMN_TYPE, COLUMN_KEY, EXTRA
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND COLUMN_NAME = 'id'
               AND DATA_TYPE IN ('tinyint','smallint','mediumint','int','bigint')
             ORDER BY TABLE_NAME"
        );

        foreach ($tables as $col) {
            $table = $col->TABLE_NAME;
            $type = $col->COLUMN_TYPE;
            $extra = strtolower((string) $col->EXTRA);
            $hasPrimary = strtoupper((string) $col->COLUMN_KEY) === 'PRI';
            $isAi = str_contains($extra, 'auto_increment');

            if ($isAi && $hasPrimary) {
                continue;
            }

            if (! Schema::hasTable($table)) {
                continue;
            }

            $quoted = '`'.str_replace('`', '``', $table).'`';

            if (! $hasPrimary) {
                $dupes = DB::table($table)
                    ->select('id', DB::raw('COUNT(*) as c'))
                    ->groupBy('id')
                    ->having('c', '>', 1)
                    ->count();

                if ($dupes > 0) {
                    throw new RuntimeException("Cannot add PRIMARY KEY on {$table}.id: duplicates exist.");
                }

                DB::statement("ALTER TABLE {$quoted} ADD PRIMARY KEY (id)");
            }

            if (! $isAi) {
                DB::statement("ALTER TABLE {$quoted} MODIFY id {$type} NOT NULL AUTO_INCREMENT");
            }

            $maxId = (int) (DB::table($table)->max('id') ?? 0);
            $next = max($maxId + 1, 1);
            DB::statement("ALTER TABLE {$quoted} AUTO_INCREMENT = {$next}");
        }
    }

    public function down(): void
    {
        // Irreversible schema repair.
    }
};
