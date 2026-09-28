<?php

namespace Database\Seeders;

use App\Models\Setting;
use App\Support\PlatformSettings;
use Illuminate\Database\Seeder;

class SettingsSeeder extends Seeder
{
    public function run(): void
    {
        foreach (PlatformSettings::DEFAULTS as $key => $value) {
            Setting::query()->firstOrCreate(
                ['key' => $key],
                ['value' => $value]
            );
        }
    }
}
