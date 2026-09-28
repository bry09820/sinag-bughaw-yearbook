<?php

namespace App\Http\Controllers\API\Auth;

use App\Http\Controllers\Controller;
use App\Models\Consent;
use App\Models\User;
use App\Models\UserPresence;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\AbstractProvider;

class SocialAuthController extends Controller
{
    private function frontendUrl(): string
    {
        return rtrim(config('app.frontend_url', 'http://localhost:5173'), '/');
    }

    private function isAllowedMobileRedirect(?string $redirectUri): bool
    {
        return is_string($redirectUri)
            && preg_match('/^(nuyearbook:\/\/|capstoneapp:\/\/|exp:\/\/|http:\/\/localhost|http:\/\/127\.0\.0\.1|http:\/\/172\.20\.10\.\d+|https:\/\/[a-z0-9\-]+\.ngrok-free\.dev|https:\/\/yearbook-myji\.onrender\.com)/', $redirectUri);
    }

    private function encodeMobileState(string $redirectUri): string
    {
        return 'mobile:' . rtrim(strtr(base64_encode($redirectUri), '+/', '-_'), '=');
    }

    private function defaultMobileRedirect(): string
    {
        return 'nuyearbook://sso/callback';
    }

    private function googleCallbackUrl(Request $request, bool $mobile = false): string
    {
        if ($mobile && config('services.google_mobile.redirect')) {
            return config('services.google_mobile.redirect');
        }

        if (! $mobile && config('services.google.redirect')) {
            return config('services.google.redirect');
        }

        return rtrim($request->getSchemeAndHttpHost(), '/') . ($mobile ? '/app/auth/google/callback' : '/auth/google/callback');
    }

    private function googleProvider(): AbstractProvider
    {
        /** @var AbstractProvider $provider */
        $provider = Socialite::driver('google');

        return $provider;
    }

    private function decodeMobileState(?string $state): ?string
    {
        if (! is_string($state) || ! str_starts_with($state, 'mobile:')) {
            return null;
        }

        $decoded = base64_decode(strtr(substr($state, 7), '-_', '+/'), true);

        return $this->isAllowedMobileRedirect($decoded) ? $decoded : null;
    }

    private function isMobileCallbackRequest(Request $request): bool
    {
        $state = $request->query('state');
        if (is_string($state) && str_starts_with($state, 'mobile:')) {
            return true;
        }

        $mobileCallback = config('services.google_mobile.redirect');
        $mobileHost = is_string($mobileCallback) ? parse_url($mobileCallback, PHP_URL_HOST) : null;

        return is_string($mobileHost) && $mobileHost !== '' && $request->getHost() === $mobileHost;
    }

    private function redirectToMobileOrWeb(Request $request, string $query): \Illuminate\Http\RedirectResponse
    {
        $mobileRedirect = session()->pull('google_oauth_redirect_uri')
            ?: $this->decodeMobileState($request->query('state'));

        if (! $mobileRedirect && $this->isMobileCallbackRequest($request)) {
            $mobileRedirect = $this->defaultMobileRedirect();
        }

        if ($mobileRedirect) {
            $separator = str_contains($mobileRedirect, '?') ? '&' : '?';
            return redirect("{$mobileRedirect}{$separator}{$query}");
        }

        return redirect("{$this->frontendUrl()}/sso/callback?{$query}");
    }

    public function redirectToGoogle(Request $request)
    {
        $redirectUri = $request->query('redirect_uri');

        if ($this->isAllowedMobileRedirect($redirectUri)) {
            session(['google_oauth_redirect_uri' => $redirectUri]);
            return $this->googleProvider()
                ->stateless()
                ->redirectUrl($this->googleCallbackUrl($request, true))
                ->with(['state' => $this->encodeMobileState($redirectUri)])
                ->redirect();
        } elseif ($request->query('client') === 'mobile') {
            session(['google_oauth_redirect_uri' => $this->defaultMobileRedirect()]);
            return $this->googleProvider()
                ->stateless()
                ->redirectUrl($this->googleCallbackUrl($request, true))
                ->with(['state' => $this->encodeMobileState($this->defaultMobileRedirect())])
                ->redirect();
        } else {
            session()->forget('google_oauth_redirect_uri');
        }

        return $this->googleProvider()->stateless()->redirect();
    }

    public function mobileRedirectToGoogle(Request $request)
    {
        $redirectUri = $request->query('redirect_uri');

        if (! $this->isAllowedMobileRedirect($redirectUri)) {
            $redirectUri = $this->defaultMobileRedirect();
        }

        session(['google_oauth_redirect_uri' => $redirectUri]);

        return $this->googleProvider()
            ->stateless()
            ->redirectUrl($this->googleCallbackUrl($request, true))
            ->with(['state' => $this->encodeMobileState($redirectUri)])
            ->redirect();
    }

    public function handleGoogleCallback(Request $request)
    {
        $frontend = $this->frontendUrl();
        $mobileRedirect = $this->decodeMobileState($request->query('state'));

    // 1. Exchange code for Google user
    try {
        $useStatelessProvider = $mobileRedirect || ! $request->filled('state');

        $googleUser = $useStatelessProvider
            ? $this->googleProvider()->stateless()->redirectUrl($this->googleCallbackUrl($request, (bool) $mobileRedirect))->user()
            : $this->googleProvider()->user();
    } catch (\Laravel\Socialite\Two\InvalidStateException $e) {
        Log::warning('Google OAuth: InvalidStateException — session likely expired or duplicate callback.', [
            'message' => $e->getMessage(),
        ]);
        return $this->redirectToMobileOrWeb($request, 'error=sso_failed');
    } catch (\Throwable $e) {
        Log::error('Google OAuth callback failed', [
            'exception' => get_class($e),
            'message'   => $e->getMessage(),
        ]);
        return $this->redirectToMobileOrWeb($request, 'error=sso_failed');
    }

        // 2. Validate email is present
        $email = $googleUser->getEmail();
        if (! $email) {
            Log::warning('Google OAuth: no email returned from Google.');
            return $this->redirectToMobileOrWeb($request, 'error=sso_failed');
        }

        // 3. Upsert user record
        try {
            $nameParts = explode(' ', trim($googleUser->getName()), 2);
            User::disableSearchSyncing();

            $user = User::where('google_id', $googleUser->getId())
                        ->orWhere('email', $email)
                        ->first();

            if ($user) {
                // Existing user link Google account and refresh token/avatar
                $user->update([
                    'google_id'         => $googleUser->getId(),
                    'google_token'      => $googleUser->token,
                    'avatar'            => $googleUser->getAvatar(),
                    'email_verified'    => true,
                    'email_verified_at' => $user->email_verified_at ?? now(),
                    'consent_accepted'  => true,
                ]);
            } else {
                // Create full record for first-time SSO user
                $user = User::create([
                    'google_id'         => $googleUser->getId(),
                    'name'              => $googleUser->getName(),
                    'first_name'        => $nameParts[0] ?? '',
                    'last_name'         => $nameParts[1] ?? '',
                    'email'             => $email,
                    'google_token'      => $googleUser->token,
                    'avatar'            => $googleUser->getAvatar(),
                    'email_verified'    => true,
                    'email_verified_at' => now(),
                    'consent_accepted'  => true,
                    'password'          => Hash::make(Str::random(32)),
                ]);
            }
            User::enableSearchSyncing();
        } catch (\Throwable $e) {
            User::enableSearchSyncing();
            Log::error('Google OAuth: failed to upsert user', [
                'email'     => $email,
                'exception' => get_class($e),
                'message'   => $e->getMessage(),
            ]);
            return $this->redirectToMobileOrWeb($request, 'error=sso_failed');
        }

        // 4. Auto-create consent log for SSO users
        try {
            Consent::updateOrCreate(
                [
                    'user_id' => $user->id,
                    'type'    => 'privacy_policy',
                ],
                [
                    'version'     => '1.0',
                    'accepted'    => true,
                    'ip_address'  => $request->ip(),
                    'user_agent'  => $request->userAgent(),
                    'accepted_at' => now(),
                ]
            );
        } catch (\Throwable $e) {
            Log::warning('Google OAuth: failed to store consent log', [
                'user_id'   => $user->id,
                'exception' => get_class($e),
                'message'   => $e->getMessage(),
            ]);
        }

        // 5. Issue Sanctum token
        try {
            $user->tokens()->where('name', 'google-sso')->delete();
            $token = $user->createToken('google-sso')->plainTextToken;
        } catch (\Throwable $e) {
            Log::error('Google OAuth: failed to issue token', [
                'user_id'   => $user->id,
                'exception' => get_class($e),
                'message'   => $e->getMessage(),
            ]);
            return $this->redirectToMobileOrWeb($request, 'error=sso_failed');
        }

        try {
            UserPresence::updateOrCreate(
                ['user_id' => $user->id],
                [
                    'is_online'    => true,
                    'last_seen_at' => now(),
                ]
            );
        } catch (\Throwable $e) {
            Log::warning('Google OAuth: failed to update presence', [
                'user_id'   => $user->id,
                'exception' => get_class($e),
                'message'   => $e->getMessage(),
            ]);
        }

        // 6. Send token to React via URL param
        return $this->redirectToMobileOrWeb($request, http_build_query(['token' => $token]));
    }

    public function mobileHandleGoogleCallback(Request $request)
    {
        return $this->handleGoogleCallback($request);
    }
}
