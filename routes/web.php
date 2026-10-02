<?php

use App\Http\Controllers\API\Auth\SocialAuthController;
use App\Http\Controllers\BillingController;
use Illuminate\Support\Facades\Route;

// WEB Google OAuth
Route::get('/auth/google', [SocialAuthController::class, 'redirectToGoogle'])
    ->name('auth.google.redirect');

Route::get('/auth/google/redirect', [SocialAuthController::class, 'redirectToGoogle'])
    ->name('auth.google.redirect.alias');

Route::get('/auth/google/callback', [SocialAuthController::class, 'handleGoogleCallback'])
    ->name('auth.google.callback');

//  MOBILE Google OAuth 
Route::get('/app/auth/google', [SocialAuthController::class, 'mobileRedirectToGoogle'])
    ->name('auth.google.mobile.redirect');

Route::get('/app/auth/google/redirect', [SocialAuthController::class, 'mobileRedirectToGoogle'])
    ->name('auth.google.mobile.redirect.alias');

Route::get('/app/auth/google/callback', [SocialAuthController::class, 'mobileHandleGoogleCallback'])
    ->name('auth.google.mobile.callback');

// PayMongo billing / checkout (must be before SPA catch-all so /billing is not 404)
Route::middleware(['auth:sanctum', 'verified', 'active.account'])->group(function () {
    Route::match(['get', 'post'], '/billing', [BillingController::class, 'checkout'])
        ->name('billing');
    Route::match(['get', 'post'], '/billing/checkout', [BillingController::class, 'checkout'])
        ->name('billing.checkout');
    Route::match(['get', 'post'], '/checkout', [BillingController::class, 'checkout'])
        ->name('checkout');
});

// SPA catch-all including "/" (must be LAST).
// Optional {any?} is required so the root URL matches; the negative
// lookahead keeps Google OAuth + billing routes above from being swallowed.
Route::get('/{any?}', function () {
    return view('app');
})->where('any', '^(?!(auth|app/auth|billing|checkout)(/|$)).*');
