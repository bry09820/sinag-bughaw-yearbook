<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\Admin;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureEmailIsVerified
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->user();

        // Admins use a separate auth flow.
        if ($actor instanceof Admin) {
            return $next($request);
        }

        if ($actor instanceof User && ! $actor->email_verified) {
            $request->user()?->currentAccessToken()?->delete();

            return response()->json([
                'message' => 'Email verification required. Please enter the code sent to your email.',
                'code'    => 'EMAIL_UNVERIFIED',
            ], 403);
        }

        return $next($request);
    }
}
