<?php

namespace App\Http\Controllers\API\Auth;

use App\Contracts\FaceRecognition;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Setting;
use Illuminate\Http\UploadedFile;
use App\Jobs\AI\ProcessFaceIndexing;
use App\Jobs\Notification\SendOtpEmail;
use App\Models\Batch;
use App\Models\Consent;
use App\Models\OtpVerification;
use App\Models\Student;
use App\Models\User;
use App\Models\UserPresence;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Socialite\Facades\Socialite;
use Illuminate\Support\Str;
use App\Services\Notification\BrevoMailService;
use App\Services\Security\PasswordHistoryService;
use App\Support\PlatformSettings;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use App\Support\SubscriptionAccess;

class AuthController extends Controller
{
    public function __construct(
        private readonly FaceRecognition $faceRecognition,
    ) {}

    // Register

    public function register(Request $request)
    {
        if (PlatformSettings::bool('maintenance_mode')) {
            return PlatformSettings::maintenanceResponse();
        }

        $request->validate([
            'first_name'       => 'required|string|max:255',
            'last_name'        => 'required|string|max:255',
            'email'            => 'required|email|unique:users',
            'password'         => 'required|min:8|confirmed',
            'student_id'       => 'required|string|max:255|unique:users,student_id',
            'course'           => 'required|string|max:255',
            'graduation_year'  => 'required|integer|min:1990|max:2100',
            'batch'            => 'nullable|string|max:255',
            'consent_accepted' => 'required|accepted',
        ]);

        try {
            return $this->createRegisteredUser($request);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('Registration failed', [
                'email'     => $request->email,
                'exception' => get_class($e),
                'message'   => $e->getMessage(),
                'file'      => $e->getFile() . ':' . $e->getLine(),
            ]);

            return response()->json([
                'message' => 'Registration failed: ' . $e->getMessage(),
                'error'   => class_basename($e),
            ], 500);
        }
    }

    private function createRegisteredUser(Request $request)
    {
        $studentRecord = $this->findMatchingStudentRecord($request);

        if ($studentRecord && $studentRecord->hasRegistered()) {
            throw ValidationException::withMessages([
                'student_id' => ['A user account is already linked to this student record.'],
            ]);
        }

        $course         = $studentRecord?->course ?: $request->course;
        $graduationYear = $studentRecord?->graduation_year ?: (int) $request->graduation_year;
        $batch          = (string) ($studentRecord?->graduation_year ?: ($request->batch ?: $request->graduation_year));
        $batchId        = $studentRecord?->batch_id
            ?: Batch::where('graduation_year', $graduationYear)
                ->where(function ($query) use ($course) {
                    $query->where('course', $course)->orWhereNull('course');
                })
                ->value('id');

        try {
            User::disableSearchSyncing();

            $user = User::create([
                'first_name'        => $studentRecord?->first_name ?? $request->first_name,
                'last_name'         => $studentRecord?->last_name ?? $request->last_name,
                'name'              => $studentRecord
                    ? trim($studentRecord->first_name . ' ' . $studentRecord->last_name)
                    : trim($request->first_name . ' ' . $request->last_name),
                'email'             => $request->email,
                'password'          => $request->password,
                'role'              => User::ROLE_STUDENT,
                'student_record_id' => $studentRecord?->id,
                'student_id'        => $studentRecord?->student_no ?? $request->student_id,
                'course'            => $course,
                'graduation_year'   => $graduationYear,
                'batch'             => $batch,
                'section_id'        => $studentRecord?->section_id,
                'batch_id'          => $batchId,
                'profile_picture'   => $studentRecord?->photo,
                'consent_accepted'  => true,
                'email_verified'    => false,
            ]);
        } finally {
            User::enableSearchSyncing();
        }

        if ($studentRecord && filled($studentRecord->photo)) {
            try {
                ProcessFaceIndexing::dispatch($user->fresh()->load('studentRecord'));
            } catch (\Throwable $e) {
                Log::warning('Face indexing dispatch failed during registration', [
                    'user_id' => $user->id,
                    'message' => $e->getMessage(),
                ]);
            }
        }

        try {
            Consent::create([
                'user_id'     => $user->id,
                'type'        => 'privacy_policy',
                'version'     => '1.0',
                'accepted'    => true,
                'ip_address'  => $request->ip(),
                'user_agent'  => $request->userAgent(),
                'accepted_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Consent log failed during registration', [
                'user_id' => $user->id,
                'message' => $e->getMessage(),
            ]);
        }

        // Do not issue an access token until the email OTP is verified.
        try {
            $this->sendVerificationOtp($user->email);
        } catch (\Throwable $e) {
            Log::error('Registration OTP send failed', [
                'email'   => $user->email,
                'message' => $e->getMessage(),
            ]);

            // Account exists; OTP row may already be stored — client can resend.
            return response()->json([
                'user'              => $this->authUserPayload($user->load('studentRecord', 'section')),
                'requires_otp'      => true,
                'email'             => $user->email,
                'email_send_failed' => true,
                'message'           => 'Account created, but we could not send the verification email. Please use Resend.',
                'is_graduate'       => ! is_null($studentRecord),
            ], 201);
        }

        $user->load('studentRecord', 'section');

        return response()->json([
            'user'         => $this->authUserPayload($user),
            'requires_otp' => true,
            'email'        => $user->email,
            'message'      => 'Account created. Enter the verification code sent to your email.',
            'is_graduate'  => ! is_null($studentRecord),
        ], 201);
    }

    // Login

    public function login(Request $request)
    {
        if (PlatformSettings::bool('maintenance_mode')) {
            return PlatformSettings::maintenanceResponse();
        }

        $request->validate([
            'email'    => 'required|email',
            'password' => 'required',
        ]);

        $email    = strtolower(trim((string) $request->input('email')));
        $password = (string) $request->input('password');

        $key      = 'student_login:' . sha1($email . '|' . $request->ip());
        $maxTries = max(1, (int) (PlatformSettings::get('max_login_attempts') ?: 5));

        if (RateLimiter::tooManyAttempts($key, $maxTries)) {
            $seconds = RateLimiter::availableIn($key);

            return response()->json([
                'message' => "Too many login attempts. Try again in {$seconds} seconds.",
                'code'    => 'LOGIN_THROTTLED',
            ], 429);
        }

        $user = User::whereRaw('LOWER(TRIM(email)) = ?', [$email])->first();

        if (! $user || ! Hash::check($password, $user->getAuthPassword())) {
            $decayMinutes = max(1, (int) (PlatformSettings::get('session_timeout_minutes') ?: 60));
            RateLimiter::hit($key, 60 * $decayMinutes);

            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        RateLimiter::clear($key);

        try {
            // Credentials OK — require email OTP before issuing a session token.
            $this->sendVerificationOtp($user->email);

            return response()->json([
                'requires_otp'     => true,
                'email'            => $user->email,
                'message'          => 'Verification code sent to your email.',
                'requires_consent' => ! $user->consent_accepted,
            ]);
        } catch (\Throwable $e) {
            Log::error('Login OTP send failed', [
                'email'   => $user->email,
                'message' => $e->getMessage(),
            ]);

            // OTP may still be stored — advance to verification UI and allow Resend.
            return response()->json([
                'requires_otp'      => true,
                'email'             => $user->email,
                'email_send_failed' => true,
                'message'           => 'We could not send the verification email. Please use Resend.',
                'requires_consent'  => ! $user->consent_accepted,
            ]);
        }
    }

    /**
     * Sign in by matching a captured face against AWS Rekognition indexed students.
     * Accepts raw or data-URI base64 JPEG/PNG from the mobile client.
     */
    public function faceLogin(Request $request)
    {
        if (PlatformSettings::bool('maintenance_mode')) {
            return PlatformSettings::maintenanceResponse();
        }

        $request->validate([
            'image_base64' => 'required|string',
            'email'        => 'nullable|email',
        ]);

        $emailHint = $request->filled('email')
            ? strtolower(trim((string) $request->input('email')))
            : null;

        $rateKey  = 'student_face_login:' . sha1(($emailHint ?? 'anon') . '|' . $request->ip());
        $maxTries = (int) PlatformSettings::get('max_login_attempts');

        if (RateLimiter::tooManyAttempts($rateKey, $maxTries)) {
            $seconds = RateLimiter::availableIn($rateKey);

            return response()->json([
                'message' => "Too many face login attempts. Try again in {$seconds} seconds.",
                'code'    => 'LOGIN_THROTTLED',
            ], 429);
        }

        if (! $this->faceRecognition->isEnabled()) {
            return response()->json([
                'message' => 'Face recognition is not configured on the server.',
                'code'    => 'FACE_RECOGNITION_DISABLED',
            ], 503);
        }

        $raw = (string) $request->input('image_base64');
        if (str_contains($raw, ',')) {
            $raw = substr($raw, strpos($raw, ',') + 1);
        }

        $bytes = base64_decode($raw, true);
        if ($bytes === false || strlen($bytes) < 256) {
            RateLimiter::hit($rateKey, 60 * (int) PlatformSettings::get('session_timeout_minutes'));

            return response()->json([
                'message' => 'Invalid face image payload.',
                'code'    => 'INVALID_FACE_IMAGE',
            ], 422);
        }

        $tmpPath = tempnam(sys_get_temp_dir(), 'face_login_');
        if ($tmpPath === false) {
            return response()->json([
                'message' => 'Unable to process face image on the server.',
            ], 500);
        }

        $imagePath = $tmpPath . '.jpg';
        @rename($tmpPath, $imagePath);
        file_put_contents($imagePath, $bytes);

        $uploaded = new UploadedFile(
            $imagePath,
            'face-login.jpg',
            'image/jpeg',
            null,
            true
        );

        try {
            $threshold = (float) Setting::getValue('face_recognition_threshold', '75');
            $result    = $this->faceRecognition->searchIndexedFaces($uploaded, 5, $threshold);
        } catch (\Throwable $e) {
            Log::warning('Face login failed', ['error' => $e->getMessage()]);
            RateLimiter::hit($rateKey, 60 * (int) PlatformSettings::get('session_timeout_minutes'));

            return response()->json([
                'message' => 'Face verification failed due to a server error.',
                'code'    => 'FACE_LOGIN_ERROR',
            ], 500);
        } finally {
            @unlink($imagePath);
            if (is_file($tmpPath)) {
                @unlink($tmpPath);
            }
        }

        $status = (string) ($result['status'] ?? '');
        if (in_array($status, ['disabled', 'error', 'no_face'], true)) {
            RateLimiter::hit($rateKey, 60 * (int) PlatformSettings::get('session_timeout_minutes'));

            $message = match ($status) {
                'disabled' => 'Face recognition is not configured on the server.',
                'no_face'  => 'No face was detected in the captured image. Please try again.',
                default    => (string) ($result['message'] ?? 'Face verification failed.'),
            };

            return response()->json([
                'message' => $message,
                'code'    => strtoupper($status === 'disabled' ? 'FACE_RECOGNITION_DISABLED' : $status),
            ], $status === 'disabled' ? 503 : 401);
        }

        $matches = collect($result['matches'] ?? [])
            ->filter(fn ($match) => filled($match['account_user_id'] ?? null))
            ->sortByDesc(fn ($match) => (float) ($match['similarity'] ?? 0))
            ->values();

        if ($matches->isEmpty()) {
            RateLimiter::hit($rateKey, 60 * (int) PlatformSettings::get('session_timeout_minutes'));
            AuditLog::record($request, 'Face Login Failed', 'No matching indexed face', AuditLog::STATUS_FAILED);

            return response()->json([
                'message' => 'Face not recognized. Please try again or sign in with email and password.',
                'code'    => 'FACE_NOT_RECOGNIZED',
            ], 401);
        }

        $user = null;

        if ($emailHint) {
            $hintUser = User::whereRaw('LOWER(TRIM(email)) = ?', [$emailHint])->first();
            if (! $hintUser) {
                RateLimiter::hit($rateKey, 60 * (int) PlatformSettings::get('session_timeout_minutes'));

                return response()->json([
                    'message' => 'Face not recognized for this account.',
                    'code'    => 'FACE_NOT_RECOGNIZED',
                ], 401);
            }

            $matchedHint = $matches->first(
                fn ($match) => (int) $match['account_user_id'] === (int) $hintUser->id
            );

            if (! $matchedHint) {
                RateLimiter::hit($rateKey, 60 * (int) PlatformSettings::get('session_timeout_minutes'));
                AuditLog::record($request, 'Face Login Failed', "Face did not match email {$emailHint}", AuditLog::STATUS_FAILED);

                return response()->json([
                    'message' => 'Face not recognized for this account.',
                    'code'    => 'FACE_NOT_RECOGNIZED',
                ], 401);
            }

            $user = $hintUser;
        } else {
            $user = User::query()->find((int) $matches->first()['account_user_id']);
        }

        if (! $user) {
            RateLimiter::hit($rateKey, 60 * (int) PlatformSettings::get('session_timeout_minutes'));

            return response()->json([
                'message' => 'Face not recognized. Please try again or sign in with email and password.',
                'code'    => 'FACE_NOT_RECOGNIZED',
            ], 401);
        }

        if (! empty($user->suspended_at) || (method_exists($user, 'trashed') && $user->trashed())) {
            return response()->json([
                'message' => 'Account is suspended or unavailable.',
                'code'    => 'ACCOUNT_UNAVAILABLE',
            ], 403);
        }

        RateLimiter::clear($rateKey);

        $token = $user->createToken('app-token')->plainTextToken;
        $this->markPresence($user->id, true);

        AuditLog::record(
            $request,
            'Face Login Success',
            "User #{$user->id} authenticated via face recognition"
        );

        $user->load('studentRecord', 'section');

        return response()->json([
            'message'          => 'Face login successful.',
            'user'             => $this->authUserPayload($user),
            'token'            => $token,
            'access_token'     => $token,
            'requires_consent' => ! $user->consent_accepted,
        ]);

    }

    // Student lookup

    public function verifyStudent(Request $request)
    {
        $request->validate([
            'student_no' => 'required|string',
            'first_name' => 'required|string',
            'last_name'  => 'required|string',
        ]);

        $typedName = $this->normalizePersonName($request->first_name . ' ' . $request->last_name);
        $student   = Student::where('student_no', trim((string) $request->student_no))
            ->get()
            ->first(function (Student $student) use ($typedName, $request) {
                $recordName = $this->normalizePersonName($student->first_name . ' ' . $student->last_name);
                $exactFirst = strtolower(trim($student->first_name)) === strtolower(trim($request->first_name));
                $exactLast  = strtolower(trim($student->last_name)) === strtolower(trim($request->last_name));

                return ($exactFirst && $exactLast)
                    || $recordName === $typedName
                    || ($typedName !== '' && str_contains($recordName, $typedName))
                    || ($recordName !== '' && str_contains($typedName, $recordName));
            });

        if (! $student) {
            return response()->json(['found' => false]);
        }

        if ($student->hasRegistered()) {
            return response()->json([
                'found'   => false,
                'message' => 'A user account is already linked to this student record.',
            ]);
        }

        return response()->json([
            'found'   => true,
            'student' => [
                'student_no'      => $student->student_no,
                'first_name'      => $student->first_name,
                'last_name'       => $student->last_name,
                'course'          => $student->course,
                'honors'          => $student->honors,
                'graduation_year' => $student->graduation_year,
                'photo'           => $student->photo_url,
                'email'           => $student->email,
            ],
        ]);
    }

    // OTP

    public function sendOtp(Request $request)
    {
        $request->validate(['email' => 'required|email']);

        $email = strtolower(trim((string) $request->email));
        $user = User::whereRaw('LOWER(TRIM(email)) = ?', [$email])->first();

        if (! $user) {
            // Avoid account enumeration.
            return response()->json(['message' => 'OTP sent to your email.']);
        }

        try {
            $this->sendVerificationOtp($user->email);
        } catch (\Throwable $e) {
            Log::error('sendOtp failed', [
                'email'   => $user->email,
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'message' => 'Failed to send verification email. Please try again.',
            ], 500);
        }

        return response()->json(['message' => 'OTP sent to your email.']);
    }

    public function verifyOtp(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'otp'   => 'required|string|size:6',
        ]);

        $email = strtolower(trim((string) $request->email));

        $record = OtpVerification::whereRaw('LOWER(TRIM(email)) = ?', [$email])
            ->where('type', 'verification')
            ->where('otp', $request->otp)
            ->where('used', false)
            ->where('expires_at', '>=', now())
            ->first();

        if (! $record) {
            return response()->json(['message' => 'Invalid or expired OTP.'], 422);
        }

        $record->update(['used' => true]);

        $user = User::whereRaw('LOWER(TRIM(email)) = ?', [$email])->first();

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        $user->update([
            'email_verified'    => true,
            'email_verified_at' => $user->email_verified_at ?? now(),
        ]);

        $user->tokens()->delete();
        $token = $user->createToken('app-token')->plainTextToken;
        $this->markPresence($user->id, true);

        return response()->json([
            'message'      => 'Email verified successfully.',
            'access_token' => $token,
            'token'        => $token,
            'user'         => $this->authUserPayload($user->fresh()->load('studentRecord', 'section')),
        ]);
    }

    // Forgot Password

    public function forgotPassword(Request $request)
    {
        $request->validate(['email' => 'required|email']);

        $user = User::where('email', $request->email)->first();
        if (! $user) {
            return response()->json(['message' => 'If that email is registered, a reset code has been sent.']);
        }

        $otp = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        OtpVerification::updateOrCreate(
            ['email' => $request->email, 'type' => 'password_reset'],
            [
                'otp'         => $otp,
                'expires_at'  => now()->addMinutes(10),
                'used'        => false,
                'reset_token' => null,
            ]
        );

        try {
            app(BrevoMailService::class)->sendPasswordReset(
                $request->email,
                $user->name,
                $otp
            );
        } catch (\Throwable $e) {
            Log::error('forgotPassword mailer failed: ' . $e->getMessage());
        }

        return response()->json(['message' => 'If that email is registered, a reset code has been sent.']);
    }

    public function verifyResetOtp(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'otp'   => 'required|string|size:6',
        ]);

        $record = OtpVerification::where('email', $request->email)
            ->where('type', 'password_reset')
            ->where('otp', $request->otp)
            ->where('used', false)
            ->where('expires_at', '>=', now())
            ->first();

        if (! $record) {
            return response()->json(['message' => 'Invalid or expired code.'], 422);
        }

        $resetToken = Str::random(64);
        $record->update(['reset_token' => $resetToken]);

        return response()->json(['reset_token' => $resetToken]);
    }

    public function resetPassword(Request $request)
    {
        $request->validate([
            'email'       => 'required|email',
            'reset_token' => 'required|string',
            'password'    => 'required|min:8|confirmed',
        ]);

        $record = OtpVerification::where('email', $request->email)
            ->where('type', 'password_reset')
            ->where('reset_token', $request->reset_token)
            ->where('used', false)
            ->where('expires_at', '>=', now())
            ->first();

        if (! $record) {
            return response()->json(['message' => 'Invalid or expired reset session. Please start over.'], 422);
        }

        $user = User::where('email', $request->email)->first();
        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        app(PasswordHistoryService::class)->assertNotRecentlyUsed($user, (string) $request->password);
        $previousHash = $user->password;
        $user->update(['password' => Hash::make($request->password)]);
        app(PasswordHistoryService::class)->remember($user, $previousHash);
        $record->update(['used' => true, 'reset_token' => null]);
        $user->tokens()->delete();

        return response()->json(['message' => 'Password reset successfully.']);
    }

    // Misc

    public function logout(Request $request)
    {
        $this->markPresence($request->user()->id, false);
        $request->user()->currentAccessToken()->delete();
        return response()->json(['message' => 'Logged out.']);
    }

    public function me(Request $request)
    {
        $user = $request->user()->load('studentRecord', 'section');
        $this->markPresence($user->id, true);

        return response()->json($this->authUserPayload($user));
    }

    // Private helpers

    private function findMatchingStudentRecord(Request $request): ?Student
    {
        $studentNo = trim((string) $request->student_id);
        $email     = strtolower(trim((string) $request->email));
        $firstName = trim((string) $request->first_name);
        $lastName  = trim((string) $request->last_name);
        $typedName = $this->normalizePersonName($firstName . ' ' . $lastName);

        $exact = Student::where('student_no', $studentNo)
            ->whereRaw('LOWER(TRIM(first_name)) = ?', [strtolower($firstName)])
            ->whereRaw('LOWER(TRIM(last_name)) = ?', [strtolower($lastName)])
            ->first();

        if ($exact) {
            return $exact;
        }

        $nameMatch = Student::where('student_no', $studentNo)
            ->get()
            ->first(function (Student $student) use ($typedName) {
                $recordName = $this->normalizePersonName($student->first_name . ' ' . $student->last_name);

                return $recordName === $typedName
                    || ($typedName !== '' && str_contains($recordName, $typedName))
                    || ($recordName !== '' && str_contains($typedName, $recordName));
            });

        if ($nameMatch) {
            return $nameMatch;
        }

        if ($email !== '') {
            $emailMatch = Student::whereRaw('LOWER(TRIM(email)) = ?', [$email])->first();
            if ($emailMatch && ($studentNo === '' || $emailMatch->student_no === $studentNo)) {
                return $emailMatch;
            }
        }

        return null;
    }

    private function normalizePersonName(string $name): string
    {
        return preg_replace('/[^a-z0-9]+/', '', strtolower($name)) ?: '';
    }

    private function authUserPayload(User $user): array
    {
        $user->loadMissing('studentRecord', 'section');

        return array_merge([
            'id'                  => $user->id,
            'first_name'          => $user->first_name,
            'last_name'           => $user->last_name,
            'name'                => $user->name,
            'email'               => $user->email,
            'role'                => $user->role,
            'student_record_id'   => $user->student_record_id,
            'student_id'          => $user->student_id,
            'course'              => $user->course,
            'graduation_year'     => $user->graduation_year,
            'batch'               => $user->batch,
            'section_id'          => $user->section_id,
            'batch_id'            => $user->batch_id,
            'profile_picture'     => $user->profile_picture,
            'bio'                 => $user->bio,
            'motto'               => $user->motto,
            // Required by web + mobile settings — without this, clients always default to "public".
            'profile_visibility'  => $user->profile_visibility ?: 'public',
            'visibility'          => $user->profile_visibility ?: 'public',
            'email_verified'      => (bool) $user->email_verified,
            'consent_accepted'    => (bool) $user->consent_accepted,
            'section'             => $user->section,
            'student_record'      => $user->studentRecord,
            'studentRecord'       => $user->studentRecord,
        ], SubscriptionAccess::payload($user));
    }

    private function sendVerificationOtp(string $email): void
    {
        $email = strtolower(trim($email));
        $otp = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        OtpVerification::updateOrCreate(
            ['email' => $email, 'type' => 'verification'],
            [
                'otp'        => $otp,
                'expires_at' => now()->addMinutes(10),
                'used'       => false,
            ]
        );

        // Send immediately so OTP emails work without a running queue worker.
        SendOtpEmail::dispatchSync($email, $otp);
    }

    private function markPresence(int $userId, bool $isOnline): void
    {
        try {
            UserPresence::updateOrCreate(
                ['user_id' => $userId],
                [
                    'is_online'    => $isOnline,
                    'last_seen_at' => now(),
                ]
            );
        } catch (\Throwable $e) {
            Log::warning('Presence update failed', [
                'user_id' => $userId,
                'message' => $e->getMessage(),
            ]);
        }
    }
}
