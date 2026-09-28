<?php

namespace Database\Seeders;

use App\Models\Subscription;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/**
 * Ensures known premium accounts have a valid active subscription
 * and a proper student role (tier lives on subscriptions, not users.role).
 */
class PremiumAccountSeeder extends Seeder
{
    /** @var list<array{email:string,tier:string,plan:string}> */
    private array $accounts = [
        [
            'email' => 'gagah4601@gmail.com',
            'tier'  => 'premium',
            'plan'  => 'premium_monthly',
        ],
    ];

    public function run(): void
    {
        foreach ($this->accounts as $account) {
            $user = User::where('email', $account['email'])->first();

            if (! $user) {
                $this->command?->warn("PremiumAccountSeeder: {$account['email']} not found — skipped.");
                continue;
            }

            // Role should be an account type, not a billing tier.
            if (in_array(strtolower((string) $user->role), ['premium', 'standard'], true)) {
                $user->role = User::ROLE_STUDENT;
                $user->save();
            }

            Subscription::updateOrCreate(
                ['user_id' => $user->id],
                [
                    'plan'       => $account['plan'],
                    'tier'       => $account['tier'],
                    'status'     => 'active',
                    'amount_paid'=> $account['tier'] === 'premium' ? 19900 : 9900,
                    'expires_at' => Carbon::now()->addYear(),
                ]
            );

            $this->command?->info(
                "PremiumAccountSeeder: {$account['email']} → {$account['tier']} until "
                . Carbon::now()->addYear()->toDateString()
            );
        }
    }
}
