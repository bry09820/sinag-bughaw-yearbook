<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'student_id')) {
                $table->string('student_id')->nullable()->unique()->after('role');
            }

            if (! Schema::hasColumn('users', 'course')) {
                $table->string('course')->nullable()->after('student_id');
            }

            if (! Schema::hasColumn('users', 'graduation_year')) {
                $table->integer('graduation_year')->nullable()->after('course');
            }

            if (! Schema::hasColumn('users', 'batch')) {
                $table->string('batch')->nullable()->after('graduation_year');
            }
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                "ALTER TABLE users MODIFY profile_visibility ENUM('public','batchmates','alumni_only','private') NOT NULL DEFAULT 'public'"
            );
        } elseif (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_profile_visibility_check');
            DB::statement(
                "ALTER TABLE users ADD CONSTRAINT users_profile_visibility_check CHECK (profile_visibility IN ('public','batchmates','alumni_only','private'))"
            );
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                "ALTER TABLE users MODIFY profile_visibility ENUM('public','alumni_only','private') NOT NULL DEFAULT 'public'"
            );
        } elseif (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_profile_visibility_check');
            DB::statement(
                "ALTER TABLE users ADD CONSTRAINT users_profile_visibility_check CHECK (profile_visibility IN ('public','alumni_only','private'))"
            );
        }

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'student_id')) {
                $table->dropUnique('users_student_id_unique');
                $table->dropColumn('student_id');
            }

            foreach (['course', 'graduation_year', 'batch'] as $column) {
                if (Schema::hasColumn('users', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
