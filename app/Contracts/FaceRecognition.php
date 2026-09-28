<?php

namespace App\Contracts;

use App\Models\User;
use Illuminate\Http\UploadedFile;

interface FaceRecognition
{
    public function isEnabled(): bool;
    public function indexStudent(User $user): array;
    public function indexStudentFromBytes(User $user, string $bytes): array;
    public function indexPhoto(string $imageUrl, string $externalImageId): array;
    public function syncStudents(iterable $students): array;
    public function analyzePhoto(string $disk, string $path): array;
    public function searchUploadedFace(UploadedFile $file, int $maxMatches = 5, ?float $threshold = null): array;
    public function searchIndexedFaces(UploadedFile $file, int $maxMatches = 20, ?float $threshold = null): array;
    public function analyzeUploadedImage(UploadedFile $file): array;
    public function searchPhotosByFace(UploadedFile $file, int $maxMatches = 20, ?float $threshold = null): array; 
}
