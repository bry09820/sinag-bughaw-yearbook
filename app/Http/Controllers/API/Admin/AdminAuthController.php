<?php

namespace App\Http\Controllers\API\Admin;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Concerns\AuditsAdminActions;
use App\Models\Admin;
use App\Models\AuditLog;
use App\Services\Security\TotpService;
use App\Support\PlatformSettings;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class AdminAuthController extends Controller
{
    use AuditsAdminActions;

    public function __construct(private readonly TotpService $totp)
    {
    }

    // POST /api/admin/login
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $key      = 'admin_login:' . $request->ip();
        $maxTries = (int) PlatformSettings::get('max_login_attempts', 5);

        if (RateLimiter::tooManyAttempts($key, $maxTries)) {
            $seconds = RateLimiter::availableIn($key);

            $this->audit(
                AuditLog::ACTION_LOGIN_FAILED,
                "Too many login attempts for '{$request->username}'. Locked out for {$seconds}s.",
                AuditLog::STATUS_CRITICAL,
            );

            return response()->json([
                'message' => "Too many attempts. Try again in {$seconds} seconds.",
            ], 429);
        }

        $admin = Admin::where('username', $request->username)
                      ->where('is_active', true)
                      ->first();

        if (! $admin || ! Hash::check($request->password, $admin->password)) {
            RateLimiter::hit($key, 300);

            $this->audit(
                AuditLog::ACTION_LOGIN_FAILED,
                "Failed login attempt for username '{$request->username}'.",
                AuditLog::STATUS_FAILED,
            );

            return response()->json(['message' => 'Invalid credentials.'], 401);
        }

        RateLimiter::clear($key);

        $challenge = Str::random(48);
        $cacheKey = "admin_totp_challenge:{$challenge}";
        $totpSecret = $this->encryptedAdminValue($admin, 'totp_secret');
        $setupRequired = empty($totpSecret);

        $setup = null;
        if ($setupRequired) {
            // Drop undecryptable ciphertext so later Eloquent saves do not 500
            // while comparing dirty encrypted attributes (DecryptException / invalid MAC).
            $this->clearUndecryptableAttribute($admin, 'totp_secret');
            $this->clearUndecryptableAttribute($admin, 'totp_pending_secret');

            $secret = $this->encryptedAdminValue($admin, 'totp_pending_secret') ?: $this->totp->generateSecret();
            $admin->forceFill(['totp_pending_secret' => $secret])->save();
            $setup = [
                'issuer' => config('app.name', 'Sinag-Bughaw'),
                'account' => $admin->username,
                'secret' => $secret,
                'otpauth_url' => $this->totp->provisioningUri(
                    config('app.name', 'Sinag-Bughaw'),
                    $admin->username,
                    $secret,
                ),
                'qr_code_url' => 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' . rawurlencode(
                    $this->totp->provisioningUri(config('app.name', 'Sinag-Bughaw'), $admin->username, $secret)
                ),
            ];
        }

        Cache::put($cacheKey, [
            'admin_id' => $admin->id,
            'setup_required' => $setupRequired,
        ], now()->addMinutes(5));

        $this->audit(
            AuditLog::ACTION_LOGIN_FAILED,
            "Admin '{$admin->username}' passed password check and must complete Google Authenticator verification.",
            AuditLog::STATUS_SUCCESS,
        );

        return response()->json([
            'two_factor_required' => true,
            'challenge' => $challenge,
            'setup_required' => $setupRequired,
            'setup' => $setup,
        ]);
    }

    // POST /api/admin/login/totp
    public function verifyTotp(Request $request): JsonResponse
    {
        $request->validate([
            'challenge' => 'required|string',
            'code' => 'required|string',
        ]);

        $challenge = (string) $request->input('challenge');
        $cacheKey = "admin_totp_challenge:{$challenge}";
        $payload = Cache::get($cacheKey);

        if (! is_array($payload) || empty($payload['admin_id'])) {
            return response()->json(['message' => 'Invalid or expired authenticator challenge.'], 422);
        }

        $admin = Admin::whereKey($payload['admin_id'])->where('is_active', true)->first();
        if (! $admin) {
            Cache::forget($cacheKey);

            return response()->json(['message' => 'Admin account is unavailable.'], 403);
        }

        $setupRequired = (bool) ($payload['setup_required'] ?? false);
        $secret = $setupRequired
            ? $this->encryptedAdminValue($admin, 'totp_pending_secret')
            : $this->encryptedAdminValue($admin, 'totp_secret');

        if (! $secret || ! $this->totp->verify($secret, (string) $request->input('code'))) {
            $this->audit(
                AuditLog::ACTION_LOGIN_FAILED,
                "Invalid Google Authenticator code for admin '{$admin->username}'.",
                AuditLog::STATUS_FAILED,
            );

            return response()->json(['message' => 'Invalid authenticator code.'], 422);
        }

        if ($setupRequired) {
            $this->activateTotpSecret($admin, $secret);
        }

        Cache::forget($cacheKey);

        $admin->tokens()->delete();
        $admin->update(['last_login_at' => now(), 'last_seen_at' => now()]);
        $token = $admin->createToken('admin-token', ['admin'], now()->addMinutes((int) config('sanctum.expiration', 480)))->plainTextToken;

        $this->audit(
            AuditLog::ACTION_LOGIN,
            "Admin '{$admin->username}' (role: {$admin->role}) logged in with Google Authenticator.",
            AuditLog::STATUS_SUCCESS,
        );

        return response()->json([
            'token' => $token,
            'admin' => $this->resource($admin),
        ]);
    }

    // POST /api/admin/logout
    public function logout(Request $request): JsonResponse
    {
        $username = $request->user()->username;

        $this->audit(
            AuditLog::ACTION_LOGOUT,
            "Admin '{$username}' logged out.",
            AuditLog::STATUS_SUCCESS,
        );

        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }

    // GET /api/admin/me
    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->resource($request->user())]);
    }

    private function resource(Admin $admin): array
    {
        return [
            'id'             => $admin->id,
            'name'           => $admin->name,
            'username'       => $admin->username,
            'role'           => $admin->role,
            'is_super_admin' => $admin->isSuperAdmin(),
            'totp_enabled'   => ! empty($this->encryptedAdminValue($admin, 'totp_secret')),
            'last_login_at'  => $admin->last_login_at?->toISOString(),
        ];
    }

    private function encryptedAdminValue(Admin $admin, string $attribute): ?string
    {
        $raw = $admin->getRawOriginal($attribute);

        if ($raw === null || $raw === '') {
            return null;
        }

        try {
            $value = $admin->getAttribute($attribute);
        } catch (DecryptException $exception) {
            Log::warning('Invalid encrypted admin attribute payload.', [
                'admin_id' => $admin->id,
                'attribute' => $attribute,
            ]);

            return null;
        }

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * Promote a verified pending TOTP secret without Eloquent dirty-checks
     * decrypting any prior corrupt totp_secret ciphertext.
     */
    private function activateTotpSecret(Admin $admin, string $secret): void
    {
        DB::table('admins')->where('id', $admin->id)->update([
            'totp_secret' => Crypt::encryptString($secret),
            'totp_pending_secret' => null,
            'totp_enabled_at' => now(),
            'updated_at' => now(),
        ]);

        $admin->refresh();
    }

    /**
     * Null out encrypted columns that cannot be decrypted with the current APP_KEY
     * so subsequent model saves do not throw DecryptException during dirty checks.
     */
    private function clearUndecryptableAttribute(Admin $admin, string $attribute): void
    {
        $raw = $admin->getRawOriginal($attribute);

        if ($raw === null || $raw === '') {
            return;
        }

        if ($this->encryptedAdminValue($admin, $attribute) !== null) {
            return;
        }

        DB::table('admins')->where('id', $admin->id)->update([
            $attribute => null,
            'updated_at' => now(),
        ]);

        $attributes = $admin->getAttributes();
        $attributes[$attribute] = null;
        $admin->setRawAttributes($attributes);
        $admin->syncOriginalAttribute($attribute);
    }
}
