<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Album extends Model
{
    use HasFactory, SoftDeletes;

    protected $table = 'albums';

    protected $fillable = [
        'title',
        'description',
        'type',
        'category',
        'event_date',
        'cover_image',
        'media_url',
        'status',
        'published_at',
        'user_id',
        'batch_id',
        'cloudinary_public_id',
        'approved_at',
        'rejected_at',
    ];

    protected $casts = [
        'event_date'   => 'date',
        'published_at' => 'datetime',
        'approved_at'  => 'datetime',
        'rejected_at'  => 'datetime',
    ];

    // Relationships

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function photos(): HasMany
    {
        return $this->hasMany(Gallery::class)
                    ->where('status', 'approved')
                    ->orderBy('sort_order');
    }

    public function galleries(): HasMany
    {
        return $this->hasMany(Gallery::class)->orderBy('sort_order');
    }

    // Scopes 

    public function scopePublished(Builder $query): Builder
    {
        return $query->where(function ($q) {
            $q->where('status', 'published')
                ->orWhereNotNull('published_at');
        });
    }

    public function scopeGeneral(Builder $query): Builder
    {
        return $query->where('type', 'general');
    }

    public function scopeGraduation(Builder $query): Builder
    {
        return $query->where('type', 'graduation');
    }

    public function scopeOfCategory(Builder $query, string $category): Builder
    {
        return $query->where('category', $category);
    }
}
