<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('messages') || ! Schema::hasColumn('messages', 'body')) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE messages MODIFY body TEXT NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE messages ALTER COLUMN body DROP NOT NULL');
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('messages') || ! Schema::hasColumn('messages', 'body')) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement("UPDATE messages SET body = '' WHERE body IS NULL");
            DB::statement('ALTER TABLE messages MODIFY body TEXT NOT NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement("UPDATE messages SET body = '' WHERE body IS NULL");
            DB::statement('ALTER TABLE messages ALTER COLUMN body SET NOT NULL');
        }
    }
};
