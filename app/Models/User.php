<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Laravel\Scout\Searchable;
use App\Models\Achievement;

class User extends Authenticatable
{
    use HasFactory, Notifiable, HasApiTokens, Searchable, SoftDeletes;

    public const ROLE_STUDENT = 'student';
    public const ROLE_ALUMNI = 'alumni';
    public const ROLE_FACULTY = 'faculty';
    public const ROLE_ADMIN = 'admin';


    public const DEPARTMENT_COURSES = [
        'SACE' => [
            'Bachelor of Science in Architecture',
            'Bachelor of Science in Civil Engineering',
            'Bachelor of Science in Computer Science',
            'Bachelor of Science in Information Technology',
            'Bachelor of Multimedia Arts',
        ],
        'SAHS' => [
            'Bachelor of Science in Nursing',
            'Bachelor of Science in Medical Technology',
            'Bachelor of Science in Psychology',
        ],
        'SABM' => [
            'Bachelor of Science in Accountancy',
            'Bachelor of Science in Business Administration - Financial Management',
            'Bachelor of Science in Business Administration - Marketing Management',
            'Bachelor of Science in Tourism Management',
        ],
        'SGS' => [
            'Master in Management',
        ],
        'SHS' => [
            'ABM',
            'STEM',
            'HUMSS',
        ],
    ];

    public const COURSE_SHORT = [
        'Bachelor of Science in Architecture'                                    => 'BSArch',
        'Bachelor of Science in Civil Engineering'                               => 'BSCE',
        'Bachelor of Science in Computer Science'                                => 'BSCS',
        'Bachelor of Science in Information Technology'                          => 'BSIT',
        'Bachelor of Multimedia Arts'                                            => 'BMA',
        'Bachelor of Science in Nursing'                                         => 'BSN',
        'Bachelor of Science in Medical Technology'                              => 'BSMT',
        'Bachelor of Science in Psychology'                                      => 'BSPsy',
        'Bachelor of Science in Accountancy'                                     => 'BSA',
        'Bachelor of Science in Business Administration - Financial Management'  => 'BSBA-FM',
        'Bachelor of Science in Business Administration - Marketing Management'  => 'BSBA-MM',
        'Bachelor of Science in Tourism Management'                              => 'BSTM',
        'Master in Management'                                                   => 'MM',
        'ABM'                                                                    => 'ABM',
        'STEM'                                                                   => 'STEM',
        'HUMSS'                                                                  => 'HUMSS',
    ];

    public static function getDepartment(string $course): ?string
    {
        foreach (self::DEPARTMENT_COURSES as $dept => $courses) {
            if (in_array($course, $courses, true)) {
                return $dept;
            }
        }
        return null;
    }

    // illable 
    // Only auth + account fields. All yearbook data lives in students table.

    protected $fillable = [
        // Identity 
        'first_name',
        'last_name',
        'name',

        //  Auth 
        'email',
        'password',
        'role',

        // Link to yearbook record
        'student_record_id',

        // Section / Batch 
        'section_id',
        'batch_id',

        // Profile (user-owned, not yearbook data) 
        'avatar',
        'bio',
        'profile_visibility',
        'profile_views',
        'profile_picture',
        'profile_picture_public_id',
        'student_id',
        'course',
        'graduation_year',
        'batch',
        'motto',
        //  Consent / Verification 
        'email_verified',
        'consent_accepted',
        //  SSO 
        'google_id',
        'google_token',
        'fcm_token',
    ];

    protected $hidden = ['password', 'remember_token', 'google_token'];

    protected $appends = [
        'student_id',
        'course',
        'graduation_year',
        'batch',
        'nickname',
        'birthday',
        'hometown',
        'honors',
        'organizations',
        'motto',
        'ambition',
        'future_plans',
        'fondest_memory',
        'most_likely_to',
        'message_to_batchmates',
        'message_to_parents',
        'facebook_url',
        'instagram_url',
        'linkedin_url',
        'github_url',
        'profile_picture',
        'department',
        'is_premium',
        'is_subscribed',
        'tier',
        'posts_count',
        'tagged_count',
    ];
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password'          => 'hashed',
            'email_verified'    => 'boolean',
            'consent_accepted'  => 'boolean',
            'profile_views'     => 'integer',
        ];
    }

    // Relationships

    public function studentRecord(): BelongsTo
    {
        return $this->belongsTo(Student::class, 'student_record_id');
    }

    public function section(): BelongsTo
    {
        return $this->belongsTo(Section::class);
    }

    public function batchRecord(): BelongsTo
    {
        return $this->belongsTo(Batch::class, 'batch_id');
    }

    public function consents(): HasMany
    {
        return $this->hasMany(Consent::class);
    }

    public function subscriptions(): HasMany
    {
        return $this->hasMany(Subscription::class);
    }

    public function achievements(): HasMany
    {
        return $this->hasMany(Achievement::class);
    }

    public function careerProfile(): HasOne
    {
        return $this->hasOne(CareerProfile::class);
    }

    public function photos(): HasMany
    {
        return $this->hasMany(Photo::class);
    }

    public function taggedPhotos(): HasMany
    {
        return $this->hasMany(TaggedPhoto::class);
    }

    // Convenience helpers 

    public function isLinkedToStudent(): bool
    {
        return ! is_null($this->student_record_id);
    }

    public function activeSubscription(): ?Subscription
    {
        return $this->subscriptions()
            ->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->latest('id')
            ->first();
    }

    public function subscriptionTier(): string
    {
        return \App\Support\SubscriptionAccess::tierFor($this);
    }

    public function hasPremiumAccess(): bool
    {
        return \App\Support\SubscriptionAccess::isPremium($this);
    }

    public function hasStandardAccess(): bool
    {
        return \App\Support\SubscriptionAccess::isStandard($this);
    }

    public function getIsPremiumAttribute(): bool
    {
        return $this->hasPremiumAccess();
    }

    public function getIsSubscribedAttribute(): bool
    {
        return \App\Support\SubscriptionAccess::isSubscribed($this);
    }

    public function getTierAttribute(): string
    {
        // Always resolve from SubscriptionAccess so Navbar/Directory/Analytics stay in sync.
        return $this->subscriptionTier();
    }

    public function getStudentIdAttribute(): ?string
    {
        return $this->studentRecord?->student_no
            ?? $this->attributes['student_id']
            ?? null;
    }

    public function getCourseAttribute(): ?string
    {
        return $this->studentRecord?->course
            ?? $this->attributes['course']
            ?? null;
    }

    public function getGraduationYearAttribute(): ?int
    {
        $year = $this->studentRecord?->graduation_year
            ?? $this->attributes['graduation_year']
            ?? null;

        return $year ? (int) $year : null;
    }

    public function getBatchAttribute(): ?string
    {
        if ($this->studentRecord?->graduation_year) {
            return (string) $this->studentRecord->graduation_year;
        }

        return $this->attributes['batch']
            ?? ($this->attributes['graduation_year'] ?? null);
    }

    public function getNicknameAttribute(): ?string
    {
        return $this->studentRecord?->nickname;
    }

    public function getBirthdayAttribute(): ?string
    {
        return $this->studentRecord?->birthday;
    }

    public function getHometownAttribute(): ?string
    {
        return $this->studentRecord?->hometown;
    }

    public function getHonorsAttribute(): ?string
    {
        return $this->studentRecord?->honors;
    }

    public function getOrganizationsAttribute(): ?string
    {
        return $this->studentRecord?->organizations;
    }

    public function getAchievementsTextAttribute(): ?string
    {
        // Named 'achievements_text' to avoid conflict with achievements() HasMany
        return $this->studentRecord?->achievements;
    }

    public function getMottoAttribute(): ?string
    {
        return $this->studentRecord?->motto
            ?? $this->attributes['motto']
            ?? null;
    }

    public function getAmbitionAttribute(): ?string
    {
        return $this->studentRecord?->ambition;
    }

    public function getFuturePlansAttribute(): ?string
    {
        return $this->studentRecord?->future_plans;
    }

    public function getFondestMemoryAttribute(): ?string
    {
        return $this->studentRecord?->fondest_memory;
    }

    public function getMostLikelyToAttribute(): ?string
    {
        return $this->studentRecord?->most_likely_to;
    }

    public function getMessageToBatchmatesAttribute(): ?string
    {
        return $this->studentRecord?->message_to_batchmates;
    }

    public function getMessageToParentsAttribute(): ?string
    {
        return $this->studentRecord?->message_to_parents;
    }

    public function getFacebookUrlAttribute(): ?string
    {
        return $this->studentRecord?->facebook_url;
    }

    public function getInstagramUrlAttribute(): ?string
    {
        return $this->studentRecord?->instagram_url;
    }

    public function getLinkedinUrlAttribute(): ?string
    {
        return $this->studentRecord?->linkedin_url;
    }

    public function getGithubUrlAttribute(): ?string
    {
        return $this->studentRecord?->github_url;
    }

    public function getProfilePictureAttribute(): ?string
    {
        // User's own uploaded photo takes priority; fall back to student record photo
        return $this->attributes['profile_picture']
            ?? $this->studentRecord?->photo
            ?? null;
    }

    public function getProfilePicturePublicIdAttribute(): ?string
    {
        return $this->attributes['profile_picture_public_id']
            ?? $this->studentRecord?->photo_public_id
            ?? null;
    }

    // Other accessors 

    public function getFullNameAttribute(): string
    {
        return "{$this->first_name} {$this->last_name}";
    }

    public function getDepartmentAttribute(): ?string
    {
        return self::getDepartment($this->course ?? '');
    }

    public function isSsoUser(): bool
    {
        return ! is_null($this->google_id);
    }

    //Meilisearch 
    public function searchableAs(): string
    {
        return 'users';
    }

    public function toSearchableArray(): array
    {
        // Load studentRecord if not already loaded
        $this->loadMissing('studentRecord');

        return [
            'id'              => $this->id,
            'name'            => $this->name,
            'student_id'      => $this->student_id,          // via accessor student_no
            'email'           => $this->email,
            'course'          => $this->course,               // via accessor
            'course_short'    => self::COURSE_SHORT[$this->course ?? ''] ?? $this->course,
            'section'         => $this->section?->name,
            'batch'           => $this->batch,                // via accessor
            'batch_id'        => $this->batch_id,
            'department'      => self::getDepartment($this->course ?? ''),
            'graduation_year' => $this->graduation_year,      // via accessor
            'profile_picture' => $this->profile_picture,      // via accessor
            'avatar'          => $this->avatar,
            'role'            => $this->role ?? 'student',
            'created_at'      => $this->created_at?->timestamp,
        ];
    }

    public function shouldBeSearchable(): bool
    {
        return in_array($this->role, [self::ROLE_STUDENT, self::ROLE_ALUMNI], true);
    }

    public function isAlumni(): bool
    {
        return $this->role === self::ROLE_ALUMNI;
    }

    public function getPostsCountAttribute(): int
    {
        return \App\Models\Photo::where('user_id', $this->id)
            ->where('status', 'approved')
            ->count();
    }

    public function getTaggedCountAttribute(): int
    {
        return \App\Models\TaggedPhoto::where('user_id', $this->id)
            ->where('status', 'approved')
            ->count();
    }
}
