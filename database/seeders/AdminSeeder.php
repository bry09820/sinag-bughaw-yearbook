<?php

namespace Database\Seeders;

use App\Models\Admin;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminSeeder extends Seeder
{
    public function run(): void
    {
        $superPassword = (string) env('SEED_SUPERADMIN_PASSWORD', 'SuperAdmin@2025!');
        $adminPassword = (string) env('SEED_ADMIN_PASSWORD', 'Admin@2025!');

        $super = Admin::updateOrCreate(
            ['username' => 'superadmin'],
            [
                'name'      => 'Super Administrator',
                'password'  => Hash::make($superPassword),
                'role'      => Admin::ROLE_SUPER_ADMIN,
                'is_active' => true,
            ]
        );

        Admin::updateOrCreate(
            ['username' => 'admin'],
            [
                'name'       => 'Default Admin',
                'password'   => Hash::make($adminPassword),
                'role'       => Admin::ROLE_ADMIN,
                'is_active'  => true,
                'created_by' => $super->id,
            ]
        );

        $this->command?->info('Admin accounts seeded (change passwords after first login):');
        $this->command?->line('  superadmin  /  (SEED_SUPERADMIN_PASSWORD or SuperAdmin@2025!)');
        $this->command?->line('  admin       /  (SEED_ADMIN_PASSWORD or Admin@2025!)');
    }
}
