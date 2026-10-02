<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE achievements DROP CONSTRAINT IF EXISTS achievements_type_check');
        }

        Schema::table('achievements', function (Blueprint $table) {
            $table->text('type')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('achievements', function (Blueprint $table) {
            $table->enum('type', ['academic', 'sports', 'leadership', 'other'])
                ->nullable()->change();
        });
    }
};
