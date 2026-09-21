<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Repair yearbook_db.users when id lost PRIMARY KEY / AUTO_INCREMENT
 * (causes registration: Field 'id' doesn't have a default value).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'id')) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();
        if ($driver !== 'mysql') {
            return;
        }

        $indexes = DB::select('SHOW INDEX FROM users');
        $hasPrimary = collect($indexes)->contains(fn ($idx) => $idx->Key_name === 'PRIMARY');

        $columns = DB::select('SHOW COLUMNS FROM users');
        $idColumn = collect($columns)->first(fn ($col) => $col->Field === 'id');
        $extra = strtolower((string) ($idColumn->Extra ?? ''));
        $isAutoIncrement = str_contains($extra, 'auto_increment');

        if (! $hasPrimary) {
            $dupes = DB::table('users')
                ->select('id', DB::raw('COUNT(*) as c'))
                ->groupBy('id')
                ->having('c', '>', 1)
                ->count();

            if ($dupes > 0) {
                throw new RuntimeException(
                    'Cannot repair users.id primary key: duplicate id values exist.'
                );
            }

            DB::statement('ALTER TABLE users ADD PRIMARY KEY (id)');
        }

        if (! $isAutoIncrement) {
            DB::statement('ALTER TABLE users MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
        }

        $maxId = (int) DB::table('users')->max('id');
        $next = max($maxId + 1, 1);
        DB::statement("ALTER TABLE users AUTO_INCREMENT = {$next}");

        $hasEmailUnique = collect($indexes)->contains(
            fn ($idx) => $idx->Column_name === 'email' && (int) $idx->Non_unique === 0
        );

        // Re-read indexes after possible PK change.
        if (! $hasEmailUnique) {
            $indexes = DB::select('SHOW INDEX FROM users');
            $hasEmailUnique = collect($indexes)->contains(
                fn ($idx) => $idx->Column_name === 'email' && (int) $idx->Non_unique === 0
            );
        }

        if (! $hasEmailUnique && Schema::hasColumn('users', 'email')) {
            $emailDupes = DB::table('users')
                ->select('email', DB::raw('COUNT(*) as c'))
                ->groupBy('email')
                ->having('c', '>', 1)
                ->count();

            if ($emailDupes === 0) {
                DB::statement('ALTER TABLE users ADD UNIQUE users_email_unique (email)');
            }
        }
    }

    public function down(): void
    {
        // Irreversible repair — do not drop PK/AI in down().
    }
};
