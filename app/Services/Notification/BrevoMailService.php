<?php

namespace App\Services\Notification;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class BrevoMailService
{
    private string $apiUrl = 'https://api.brevo.com/v3/smtp/email';
    private ?string $apiKey;
    private string $fromAddress;
    private string $fromName;

    public function __construct()
    {
        $this->apiKey = config('brevo.api_key');
        $this->fromAddress = (string) (
            config('brevo.from_address')
            ?: config('mail.from.address')
            ?: ''
        );
        $this->fromName = (string) (
            config('brevo.from_name')
            ?: config('mail.from.name')
            ?: 'Sinag-Bughaw'
        );
    }

    public function sendOtp(string $toEmail, string $toName, string $otp): bool
    {
        return $this->sendEmail(
            $toEmail,
            $toName,
            'Your Sinag-Bughaw Verification Code',
            $this->layout('Verification Code', "
                <p>Use the code below to verify your identity. It expires in <strong>10 minutes</strong>.</p>
                <div style=\"background:#f1f5f9;border-radius:12px;padding:28px;text-align:center;margin:24px 0\">
                    <div style=\"font-size:44px;font-weight:900;color:#3f51b5;letter-spacing:14px\">{$otp}</div>
                    <div style=\"font-size:12px;color:#94a3b8;margin-top:8px\">One-time verification code</div>
                </div>
                <p style=\"font-size:12px;color:#92400e\">Never share this code. NU Lipa staff will never ask for it.</p>
            "),
            "Your OTP code is: {$otp}. It expires in 10 minutes.",
            'OTP'
        );
    }

    public function sendPasswordReset(string $toEmail, string $toName, string $otp): bool
    {
        return $this->sendEmail(
            $toEmail,
            $toName,
            'Reset Your Sinag-Bughaw Password',
            $this->layout('Reset Your Password', "
                <p>Hi <strong>" . e($toName) . "</strong>,</p>
                <p>Use the code below to reset your Sinag-Bughaw password. It expires in <strong>10 minutes</strong>.</p>
                <div style=\"background:#f1f5f9;border-radius:12px;padding:28px;text-align:center;margin:24px 0\">
                    <div style=\"font-size:44px;font-weight:900;color:#1d2b4b;letter-spacing:14px\">{$otp}</div>
                    <div style=\"font-size:12px;color:#94a3b8;margin-top:8px\">Password reset code</div>
                </div>
                <p style=\"font-size:12px;color:#991b1b\">If you did not request this, ignore this email.</p>
            "),
            "Your password reset code is: {$otp}. It expires in 10 minutes. If you did not request this, ignore this email.",
            'PasswordReset'
        );
    }

    public function sendAnnouncement(
        string $toEmail,
        string $toName,
        string $title,
        string $body,
        ?string $actionUrl = null,
        ?string $actionLabel = null
    ): bool {
        $button = $this->button($actionUrl, $actionLabel ?? 'View Details');

        return $this->sendEmail(
            $toEmail,
            $toName,
            "[Sinag-Bughaw] {$title}",
            $this->layout($title, "
                <p>Hi <strong>" . e($toName) . "</strong>,</p>
                <p>" . nl2br(e($body)) . "</p>
                {$button}
            ", 'Announcement'),
            "{$title}\n\n{$body}",
            'Announcement'
        );
    }

    public function sendGraduationReminder(
        string $toEmail,
        string $toName,
        string $eventName,
        string $eventDate,
        string $eventVenue,
        ?string $actionUrl = null
    ): bool {
        $button = $this->button($actionUrl, 'View Details');

        return $this->sendEmail(
            $toEmail,
            $toName,
            "Graduation Reminder - {$eventName}",
            $this->layout("Don't Forget, " . e($toName) . '!', "
                <p>You have an upcoming graduation event.</p>
                <table style=\"width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin:20px 0\">
                    <tr><td style=\"padding:10px 14px;color:#94a3b8;font-weight:700\">Event</td><td style=\"padding:10px 14px;color:#1d2b4b;font-weight:700\">" . e($eventName) . "</td></tr>
                    <tr><td style=\"padding:10px 14px;color:#94a3b8;font-weight:700\">Date</td><td style=\"padding:10px 14px;color:#1d2b4b;font-weight:700\">" . e($eventDate) . "</td></tr>
                    <tr><td style=\"padding:10px 14px;color:#94a3b8;font-weight:700\">Venue</td><td style=\"padding:10px 14px;color:#1d2b4b;font-weight:700\">" . e($eventVenue) . "</td></tr>
                </table>
                {$button}
            ", 'Graduation Reminder'),
            "Reminder: {$eventName} on {$eventDate} at {$eventVenue}.",
            'Graduation'
        );
    }

    public function sendTaggedNotification(
        string $toEmail,
        string $toName,
        string $taggedBy,
        string $photoUrl,
        ?string $actionUrl = null,
        ?string $actionLabel = null
    ): bool {
        $button = $this->button($actionUrl, $actionLabel ?? 'View Photo');

        return $this->sendEmail(
            $toEmail,
            $toName,
            "{$taggedBy} tagged you in a photo",
            $this->layout('You were tagged!', "
                <p>Hi <strong>" . e($toName) . "</strong>,</p>
                <p><strong>" . e($taggedBy) . "</strong> tagged you in a photo on Sinag-Bughaw.</p>
                <div style=\"margin:24px 0;text-align:center\">
                    <img src=\"" . e($photoUrl) . "\" alt=\"Tagged photo\" style=\"max-width:100%;max-height:300px;border-radius:12px;border:1px solid #e2e8f0\" />
                </div>
                {$button}
            ", 'Photo Tag'),
            "Hi {$toName}, {$taggedBy} tagged you in a photo." . ($actionUrl ? " View it here: {$actionUrl}" : ''),
            'Tagged'
        );
    }

    public function sendNewMessageNotification(
        string $toEmail,
        string $toName,
        string $senderName,
        string $messagePreview,
        ?string $actionUrl = null
    ): bool {
        $button = $this->button($actionUrl, 'Reply to Message');
        $preview = e(Str::limit($messagePreview, 120));

        return $this->sendEmail(
            $toEmail,
            $toName,
            "New message from {$senderName} - Sinag-Bughaw",
            $this->layout('You have a new message', "
                <p>Hi <strong>" . e($toName) . "</strong>,</p>
                <p><strong>" . e($senderName) . "</strong> sent you a message on Sinag-Bughaw.</p>
                <div style=\"background:#f8fafc;border-left:4px solid #3f51b5;border-radius:8px;padding:16px 20px;margin:20px 0\">
                    <div style=\"font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:6px\">Message Preview</div>
                    <div style=\"font-size:14px;color:#1d2b4b;font-style:italic;line-height:1.6\">\"{$preview}\"</div>
                </div>
                {$button}
            ", 'New Message'),
            "Hi {$toName}, you have a new message from {$senderName}: \"{$messagePreview}\"" . ($actionUrl ? " Reply here: {$actionUrl}" : ''),
            'NewMessage'
        );
    }

    public function sendSubscriptionConfirmed(
        string $toEmail,
        string $toName,
        string $planName,
        string $expiryDate,
        ?string $actionUrl = null
    ): bool {
        $button = $this->button($actionUrl, 'Explore Premium Features');

        return $this->sendEmail(
            $toEmail,
            $toName,
            'Your Sinag-Bughaw subscription is active!',
            $this->layout('Welcome to Premium, ' . e($toName) . '!', "
                <p>Your subscription has been confirmed. You now have access to Sinag-Bughaw premium features.</p>
                <table style=\"width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin:20px 0\">
                    <tr><td style=\"padding:10px 14px;color:#94a3b8;font-weight:700\">Plan</td><td style=\"padding:10px 14px;color:#1d2b4b;font-weight:700\">" . e($planName) . "</td></tr>
                    <tr><td style=\"padding:10px 14px;color:#94a3b8;font-weight:700\">Valid Until</td><td style=\"padding:10px 14px;color:#1d2b4b;font-weight:700\">" . e($expiryDate) . "</td></tr>
                    <tr><td style=\"padding:10px 14px;color:#94a3b8;font-weight:700\">Status</td><td style=\"padding:10px 14px;color:#16a34a;font-weight:700\">Active</td></tr>
                </table>
                {$button}
            ", 'Subscription Active'),
            "Hi {$toName}, your {$planName} plan is now active until {$expiryDate}.",
            'SubscriptionConfirmed'
        );
    }

    private function sendEmail(
        string $toEmail,
        string $toName,
        string $subject,
        string $htmlContent,
        string $textContent,
        string $context
    ): bool {
        $mailer = (string) (config('mail.default') ?: 'smtp');

        if (in_array($mailer, ['log', 'array'], true)) {
            return $this->sendViaLaravelMailer($toEmail, $toName, $subject, $htmlContent, $textContent, $context, $mailer);
        }

        if (! $this->fromAddress) {
            Log::error("Brevo {$context} error: missing BREVO_FROM_ADDRESS / MAIL_FROM_ADDRESS.");
            return false;
        }

        // HTTPS API first: Render free instances block outbound SMTP ports 25/465/587.
        if ($this->apiKey && $this->sendViaApi($toEmail, $toName, $subject, $htmlContent, $textContent, $context)) {
            return true;
        }

        if (config("mail.mailers.{$mailer}")) {
            return $this->sendViaLaravelMailer($toEmail, $toName, $subject, $htmlContent, $textContent, $context, $mailer);
        }

        return $this->sendViaSmtp($toEmail, $toName, $subject, $htmlContent, $textContent, $context);
    }

    private function sendViaLaravelMailer(
        string $toEmail,
        string $toName,
        string $subject,
        string $htmlContent,
        string $textContent,
        string $context,
        ?string $mailerName = null
    ): bool {
        try {
            $mailerName = $mailerName ?: (string) (config('mail.default') ?: 'smtp');
            $fromAddress = $this->fromAddress
                ?: (string) config('mail.from.address', 'noreply@localhost');
            $fromName = $this->fromName
                ?: (string) config('mail.from.name', 'Sinag-Bughaw');

            \Illuminate\Support\Facades\Mail::mailer($mailerName)
                ->html($htmlContent, function ($message) use ($toEmail, $toName, $subject, $textContent, $fromAddress, $fromName) {
                    $message->to($toEmail, $toName)
                        ->from($fromAddress, $fromName)
                        ->subject($subject)
                        ->text($textContent);
                });

            Log::info("Mail ({$context}) sent via [{$mailerName}] to {$toEmail}: {$textContent}");
            return true;
        } catch (\Throwable $e) {
            Log::error("Mail ({$context}) via [{$mailerName}] failed: " . $e->getMessage());
            return false;
        }
    }

    private function sendViaApi(
        string $toEmail,
        string $toName,
        string $subject,
        string $htmlContent,
        string $textContent,
        string $context
    ): bool {
        try {
            $response = Http::timeout(15)
                ->withHeaders([
                    'accept' => 'application/json',
                    'api-key' => $this->apiKey,
                    'content-type' => 'application/json',
                ])
                ->post($this->apiUrl, [
                    'sender' => [
                        'name' => $this->fromName,
                        'email' => $this->fromAddress,
                    ],
                    'to' => [[
                        'email' => $toEmail,
                        'name' => $toName,
                    ]],
                    'subject' => $subject,
                    'htmlContent' => $htmlContent,
                    'textContent' => $textContent,
                ]);

            if ($response->successful()) {
                return true;
            }

            Log::warning("Brevo {$context} API error: {$response->status()} {$response->body()} — trying SMTP fallback");
            return false;
        } catch (\Throwable $e) {
            Log::warning("Brevo {$context} API exception: " . $e->getMessage() . ' — trying SMTP fallback');
            return false;
        }
    }

    private function sendViaSmtp(
        string $toEmail,
        string $toName,
        string $subject,
        string $htmlContent,
        string $textContent,
        string $context
    ): bool {
        $smtp = config('brevo.smtp', []);
        if (empty($smtp['username']) || empty($smtp['password'])) {
            Log::error("Brevo {$context} SMTP fallback unavailable: missing BREVO_USERNAME/BREVO_PASSWORD.");
            return false;
        }

        try {
            \Illuminate\Support\Facades\Mail::mailer('brevo')->html($htmlContent, function ($message) use ($toEmail, $toName, $subject, $textContent) {
                $message->to($toEmail, $toName)
                    ->from($this->fromAddress, $this->fromName)
                    ->subject($subject)
                    ->text($textContent);
            });

            Log::info("Brevo {$context} sent via SMTP to {$toEmail}");
            return true;
        } catch (\Throwable $e) {
            Log::error("Brevo {$context} SMTP exception: " . $e->getMessage());
            return false;
        }
    }

    private function layout(string $title, string $content, ?string $badge = null): string
    {
        $badgeMarkup = $badge
            ? '<div style="display:inline-block;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;margin-bottom:16px;text-transform:uppercase;letter-spacing:1px;background:#e0e7ff;color:#3f51b5">' . e($badge) . '</div>'
            : '';

        return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
            <body style="font-family:Inter,Arial,sans-serif;background:#f1f5f9;padding:40px 20px;margin:0">
                <div style="max-width:520px;margin:0 auto">
                    <div style="background:linear-gradient(135deg,#1d2b4b,#3f51b5);border-radius:16px 16px 0 0;padding:28px 32px">
                        <div style="color:#fff;font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase">Sinag-Bughaw</div>
                        <div style="color:#fdb813;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:2px">Digital Yearbook - NU Lipa</div>
                    </div>
                    <div style="background:#fff;border-radius:0 0 16px 16px;padding:36px 32px;box-shadow:0 8px 32px rgba(0,0,0,0.08)">
                        ' . $badgeMarkup . '
                        <h1 style="color:#1d2b4b;font-size:22px;font-weight:900;margin:0 0 8px">' . $title . '</h1>
                        <div style="color:#64748b;font-size:14px;line-height:1.7">' . $content . '</div>
                    </div>
                    <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:24px">
                        &copy; ' . date('Y') . ' National University Lipa - Sinag-Bughaw Project<br>
                        If you did not request this email, you can safely ignore it.
                    </div>
                </div>
            </body></html>';
    }

    private function button(?string $url, string $label): string
    {
        if (! $url) {
            return '';
        }

        return '<a href="' . e($url) . '" style="display:inline-block;background:#3f51b5;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:12px;margin-top:8px">' . e($label) . '</a>';
    }
}
