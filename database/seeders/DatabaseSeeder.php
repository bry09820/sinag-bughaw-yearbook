<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     *
     * Production (Hostinger): only Admin + Settings.
     * Local/dev: optional demo data via --class or SEED_DEMO_DATA=true.
     */
    public function run(): void
    {
        $this->call([
            AdminSeeder::class,
            SettingsSeeder::class,
            PremiumAccountSeeder::class,
        ]);

        if (filter_var(env('SEED_DEMO_DATA', false), FILTER_VALIDATE_BOOLEAN)) {
            $this->call([
                BatchSeeder::class,
                SectionSeeder::class,
                AlbumSeeder::class,
            ]);
        }
    }
}
