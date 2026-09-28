<?php

namespace App\Services\AI;

use App\Contracts\FaceRecognition;
use App\Models\Student;
use App\Models\User;
use Aws\Exception\AwsException;
use Aws\Rekognition\RekognitionClient;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

class AwsRekognitionFaceRecognition implements FaceRecognition
{
    private ?RekognitionClient $clientInstance = null;

    public function __construct(
        private readonly array $config,
    ) {}

    //isEnabled 

    public function isEnabled(): bool
    {
        return class_exists(RekognitionClient::class)
            && filled($this->config['key']        ?? null)
            && filled($this->config['secret']     ?? null)
            && filled($this->config['region']     ?? null)
            && filled($this->config['collection'] ?? null);
    }

    // indexStudent 

    public function indexStudent(User $user): array
    {
        if (! $this->isEnabled()) {
            return ['indexed' => false, 'reason' => 'Face recognition is not configured.'];
        }

        $imageUrl = $this->faceIndexProfilePicture($user);

        if (blank($imageUrl)) {
            return ['indexed' => false, 'reason' => 'No profile picture set.'];
        }

        $bytes = $this->resolveImageBytes($imageUrl);

        if ($bytes === null || $bytes === '') {
            return ['indexed' => false, 'reason' => 'Could not read profile picture bytes.'];
        }

        $this->ensureCollectionExists();
        $deletedFaces = $this->deleteExistingStudentFaces($user);

        $result = $this->client()->indexFaces([
            'CollectionId'        => $this->collectionId(),
            'ExternalImageId'     => $this->externalImageId($user),
            'Image'               => ['Bytes' => $bytes],
            'DetectionAttributes' => ['DEFAULT'],
            'MaxFaces'            => 1,
            'QualityFilter'       => 'AUTO',
        ]);

        return [
            'indexed'           => count($result['FaceRecords'] ?? []) > 0,
            'face_records'      => count($result['FaceRecords'] ?? []),
            'unindexed_faces'   => count($result['UnindexedFaces'] ?? []),
            'external_image_id' => $this->externalImageId($user),
            'deleted_faces'      => $deletedFaces,
        ];
    }

    public function indexStudentFromBytes(User $user, string $bytes): array
    {
        if (! $this->isEnabled()) {
            return ['indexed' => false, 'reason' => 'Face recognition is not configured.'];
        }

        if ($bytes === '') {
            return ['indexed' => false, 'reason' => 'Empty face image payload.'];
        }

        $this->ensureCollectionExists();
        $deletedFaces = $this->deleteExistingStudentFaces($user);

        try {
            $result = $this->client()->indexFaces([
                'CollectionId'        => $this->collectionId(),
                'ExternalImageId'     => $this->externalImageId($user),
                'Image'               => ['Bytes' => $bytes],
                'DetectionAttributes' => ['DEFAULT'],
                'MaxFaces'            => 1,
                'QualityFilter'       => 'AUTO',
            ]);
        } catch (AwsException $e) {
            Log::error('[Rekognition] indexStudentFromBytes failed', [
                'user_id' => $user->id,
                'error'   => $e->getMessage(),
            ]);

            return [
                'indexed' => false,
                'reason'  => $e->getAwsErrorMessage() ?: $e->getMessage(),
            ];
        }

        return [
            'indexed'           => count($result['FaceRecords'] ?? []) > 0,
            'face_records'      => count($result['FaceRecords'] ?? []),
            'unindexed_faces'   => count($result['UnindexedFaces'] ?? []),
            'external_image_id' => $this->externalImageId($user),
            'deleted_faces'     => $deletedFaces,
        ];
    }

    // indexPhoto
    public function indexPhoto(string $imageUrl, string $externalImageId): array
    {
        if (! $this->isEnabled()) {
            return ['indexed' => false, 'reason' => 'Face recognition not configured.'];
        }

        $this->ensureCollectionExists();

        $bytes = $this->resolveImageBytes($imageUrl);

        if (! $bytes) {
            return ['indexed' => false, 'reason' => 'Could not read image bytes.'];
        }

        try {
            $result = $this->client()->indexFaces([
                'CollectionId'        => $this->collectionId(),
                'ExternalImageId'     => $externalImageId,
                'Image'               => ['Bytes' => $bytes],
                'DetectionAttributes' => ['DEFAULT'],
                'QualityFilter'       => 'AUTO',
            ]);

            $indexed = count($result['FaceRecords'] ?? []) > 0;

            Log::info('[Rekognition] indexPhoto', [
                'external_image_id' => $externalImageId,
                'indexed'           => $indexed,
                'face_records'      => count($result['FaceRecords'] ?? []),
            ]);

            return [
                'indexed'      => $indexed,
                'face_records' => count($result['FaceRecords'] ?? []),
            ];

        } catch (AwsException $e) {
            Log::error('[Rekognition] indexPhoto failed', [
                'external_image_id' => $externalImageId,
                'error'             => $e->getMessage(),
            ]);
            return ['indexed' => false, 'reason' => $e->getMessage()];
        }
    }

    // syncStudents

    public function syncStudents(iterable $students): array
    {
        $this->ensureCollectionExists();

        $summary = ['indexed' => 0, 'skipped' => 0, 'errors' => []];

        foreach ($students as $student) {
            try {
                $result = $this->indexStudent($student);
                $result['indexed'] ?? false
                    ? $summary['indexed']++
                    : $summary['skipped']++;
            } catch (\Throwable $e) {
                $summary['errors'][] = [
                    'user_id' => $student->id,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return $summary;
    }

    // analyzePhoto 

    public function analyzePhoto(string $disk, string $path): array
    {
        if (! $this->isEnabled()) {
            return [
                'status'      => 'disabled',
                'face_count'  => 0,
                'faces'       => [],
                'matches'     => [],
                'limitations' => ['Face recognition is not configured.'],
            ];
        }

        $bytes       = $this->readDiskBytes($disk, $path);
        $faceDetails = $this->client()->detectFaces([
            'Image'      => ['Bytes' => $bytes],
            'Attributes' => ['DEFAULT'],
        ]);

        $faces = collect($faceDetails['FaceDetails'] ?? [])
            ->map(fn (array $face) => [
                'confidence'   => round((float) ($face['Confidence'] ?? 0), 2),
                'bounding_box' => [
                    'width'  => (float) data_get($face, 'BoundingBox.Width',  0),
                    'height' => (float) data_get($face, 'BoundingBox.Height', 0),
                    'left'   => (float) data_get($face, 'BoundingBox.Left',   0),
                    'top'    => (float) data_get($face, 'BoundingBox.Top',    0),
                ],
            ])
            ->values()
            ->all();

        $matches     = [];
        $limitations = [];

        if (count($faces) > 0) {
            $searchResult = $this->searchBytes($bytes, 20);
            $matches      = $searchResult['matches'];

            if (count($faces) > 1) {
                $limitations[] = 'Only the largest detected face can be matched automatically.';
            }
        }

        return [
            'status'      => 'analyzed',
            'provider'    => 'aws-rekognition',
            'analyzed_at' => now()->toIso8601String(),
            'face_count'  => count($faces),
            'faces'       => $faces,
            'matches'     => $matches,
            'limitations' => $limitations,
        ];
    }

    // searchUploadedFace

    public function searchUploadedFace(
        UploadedFile $file,
        int $maxMatches = 5,
        ?float $threshold = null
    ): array {
        if (! $this->isEnabled()) {
            return ['status' => 'disabled', 'matches' => [], 'message' => 'Face recognition is not configured.'];
        }

        $this->ensureCollectionExists();

        return $this->searchBytes(
            file_get_contents($file->getRealPath()) ?: '',
            $maxMatches,
            $threshold
        );
    }

    // searchPhotosByFace 

    public function searchIndexedFaces(
        UploadedFile $file,
        int $maxMatches = 20,
        ?float $threshold = null
    ): array {
        if (! $this->isEnabled()) {
            return ['status' => 'disabled', 'matches' => [], 'message' => 'Face recognition is not configured.'];
        }

        $this->ensureCollectionExists();

        $bytes = file_get_contents($file->getRealPath()) ?: '';
        if ($bytes === '') {
            throw new InvalidArgumentException('The uploaded image could not be read.');
        }

        $threshold = $threshold ?? (float) ($this->config['threshold'] ?? 75);

        try {
            $result = $this->client()->searchFacesByImage([
                'CollectionId'       => $this->collectionId(),
                'Image'              => ['Bytes' => $bytes],
                'FaceMatchThreshold' => $threshold,
                'MaxFaces'           => $maxMatches,
                'QualityFilter'      => 'AUTO',
            ]);
        } catch (AwsException $e) {
            $message = $e->getAwsErrorMessage() ?: $e->getMessage();

            return [
                'status'  => str_contains(strtolower($message), 'no face') ? 'no_face' : 'error',
                'matches' => [],
                'message' => $message,
            ];
        }

        $matches = collect($result['FaceMatches'] ?? [])
            ->map(function (array $match) {
                $externalImageId = (string) data_get($match, 'Face.ExternalImageId');
                $user            = $this->resolveUserFromExternalImageId($externalImageId);

                return [
                    'user_id'           => $this->faceSubjectStudentRecordId($user),
                    'student_record_id' => $this->faceSubjectStudentRecordId($user),
                    'account_user_id'   => $this->faceSubjectAccountUserId($user),
                    'name'              => $this->faceSubjectName($user),
                    'student_id'        => $this->faceSubjectStudentNo($user),
                    'course'            => $this->faceSubjectCourse($user),
                    'profile_picture'   => $this->faceSubjectProfilePicture($user),
                    'similarity'        => round((float) ($match['Similarity'] ?? 0), 2),
                    'confidence'        => round((float) data_get($match, 'Face.Confidence', 0), 2),
                    'external_image_id' => $externalImageId,
                ];
            })
            ->values()
            ->all();

        return [
            'status'  => count($matches) > 0 ? 'matched' : 'no_matches',
            'matches' => $matches,
            'message' => count($matches) > 0 ? null : 'No matching indexed faces were found.',
        ];
    }

    public function searchPhotosByFace(
        UploadedFile $file,
        int $maxMatches = 20,
        ?float $threshold = null
    ): array {
        if (! $this->isEnabled()) {
            return ['status' => 'disabled', 'photos' => [], 'message' => 'Face recognition is not configured.'];
        }

        $this->ensureCollectionExists();

        $bytes     = file_get_contents($file->getRealPath()) ?: '';
        $threshold = $threshold ?? (float) ($this->config['threshold'] ?? 75);

        try {
            $result = $this->client()->searchFacesByImage([
                'CollectionId'       => $this->collectionId(),
                'Image'              => ['Bytes' => $bytes],
                'FaceMatchThreshold' => $threshold,
                'MaxFaces'           => $maxMatches,
                'QualityFilter'      => 'AUTO',
            ]);
        } catch (AwsException $e) {
            $message = $e->getAwsErrorMessage() ?: $e->getMessage();
            return [
                'status'  => str_contains(strtolower($message), 'no face') ? 'no_face' : 'error',
                'photos'  => [],
                'message' => $message,
            ];
        }

        // Collect photo:X matches with similarity scores
        $photoMatches = collect($result['FaceMatches'] ?? [])
            ->filter(fn ($m) => str_starts_with((string) data_get($m, 'Face.ExternalImageId'), 'photo:'))
            ->map(fn ($m) => [
                'photo_id'   => (int) substr(data_get($m, 'Face.ExternalImageId'), 6),
                'similarity' => round((float) ($m['Similarity'] ?? 0), 2),
            ])
            ->sortByDesc('similarity')
            ->unique('photo_id')
            ->values();

        $photoIds = $photoMatches->pluck('photo_id')->all();

        $photos = \App\Models\Photo::whereIn('id', $photoIds)
            ->with('album:id,title,event_date')
            ->get()
            ->keyBy('id');

        $results = $photoMatches->map(fn ($m) => [
            'photo_id'   => $m['photo_id'],
            'similarity' => $m['similarity'],
            'file_path'  => $photos[$m['photo_id']]?->file_path,
            'caption'    => $photos[$m['photo_id']]?->caption,
            'album_id'   => $photos[$m['photo_id']]?->album_id,
            'album'      => $photos[$m['photo_id']]?->album ? [
                'id'         => $photos[$m['photo_id']]->album->id,
                'title'      => $photos[$m['photo_id']]->album->title,
                'event_date' => $photos[$m['photo_id']]->album->event_date,
            ] : null,
        ])
        ->filter(fn ($r) => filled($r['file_path']))
        ->values()
        ->all();

        return [
            'status'  => count($results) > 0 ? 'matched' : 'no_matches',
            'photos'  => $results,
            'message' => count($results) > 0 ? null : 'No matching photos found.',
        ];
    }

    // analyzeUploadedImage 

    public function analyzeUploadedImage(UploadedFile $file): array
    {
        if (! $this->isEnabled()) {
            return ['status' => 'disabled', 'faces' => [], 'message' => 'Face recognition is not configured.'];
        }

        $bytes = file_get_contents($file->getRealPath()) ?: '';

        if ($bytes === '') {
            throw new InvalidArgumentException('The uploaded image could not be read.');
        }

        try {
            $result = $this->client()->detectFaces([
                'Image'      => ['Bytes' => $bytes],
                'Attributes' => ['ALL'],
            ]);

            $faces = collect($result['FaceDetails'] ?? [])
                ->map(fn (array $face, int $i) => [
                    'face_id'      => $i + 1,
                    'confidence'   => (float) data_get($face, 'Confidence', 0),
                    'bounding_box' => [
                        'left'   => (float) data_get($face, 'BoundingBox.Left',   0),
                        'top'    => (float) data_get($face, 'BoundingBox.Top',    0),
                        'width'  => (float) data_get($face, 'BoundingBox.Width',  0),
                        'height' => (float) data_get($face, 'BoundingBox.Height', 0),
                    ],
                    'age_range' => [
                        'low'  => (int) data_get($face, 'AgeRange.Low',  0),
                        'high' => (int) data_get($face, 'AgeRange.High', 0),
                    ],
                    'gender'   => data_get($face, 'Gender.Value', 'Unknown'),
                    'emotions' => collect(data_get($face, 'Emotions', []))
                        ->sortByDesc('Confidence')
                        ->take(3)
                        ->map(fn ($e) => [
                            'type'       => $e['Type'],
                            'confidence' => (float) $e['Confidence'],
                        ])
                        ->values()
                        ->all(),
                    'pose' => [
                        'pitch' => (float) data_get($face, 'Pose.Pitch', 0),
                        'roll'  => (float) data_get($face, 'Pose.Roll',  0),
                        'yaw'   => (float) data_get($face, 'Pose.Yaw',   0),
                    ],
                    'quality' => [
                        'brightness' => (float) data_get($face, 'Quality.Brightness', 0),
                        'sharpness'  => (float) data_get($face, 'Quality.Sharpness',  0),
                    ],
                ])
                ->filter(fn ($face) => $face['confidence'] >= 80)
                ->values()
                ->all();

            return [
                'status'      => 'analyzed',
                'provider'    => 'aws-rekognition',
                'analyzed_at' => now()->toIso8601String(),
                'face_count'  => count($faces),
                'faces'       => $faces,
                'message'     => count($faces) > 0 ? null : 'No faces detected in the uploaded image.',
            ];
        } catch (AwsException $e) {
            return [
                'status'  => 'error',
                'faces'   => [],
                'message' => $e->getAwsErrorMessage() ?: $e->getMessage(),
            ];
        }
    }

    // Private helpers

    private function searchBytes(string $bytes, int $maxMatches, ?float $threshold = null): array
    {
        if ($bytes === '') {
            throw new InvalidArgumentException('The uploaded image could not be read.');
        }

        $threshold = $threshold ?? (float) ($this->config['threshold'] ?? 90);

        try {
            $result = $this->client()->searchFacesByImage([
                'CollectionId'       => $this->collectionId(),
                'Image'              => ['Bytes' => $bytes],
                'FaceMatchThreshold' => $threshold,
                'MaxFaces'           => $maxMatches,
                'QualityFilter'      => 'AUTO',
            ]);
        } catch (AwsException $e) {
            $message = $e->getAwsErrorMessage() ?: $e->getMessage();

            return [
                'status'  => str_contains(strtolower($message), 'no face') ? 'no_face' : 'error',
                'matches' => [],
                'message' => $message,
            ];
        }

        $matches = collect($result['FaceMatches'] ?? [])
            ->map(function (array $match) {
                $externalImageId = data_get($match, 'Face.ExternalImageId');
                $user            = $this->resolveUserFromExternalImageId($externalImageId);

                return [
                    'user_id'           => $this->faceSubjectStudentRecordId($user),
                    'student_record_id' => $this->faceSubjectStudentRecordId($user),
                    'account_user_id'   => $this->faceSubjectAccountUserId($user),
                    'name'              => $this->faceSubjectName($user) ?? 'Unknown student',
                    'student_id'        => $this->faceSubjectStudentNo($user),
                    'course'            => $this->faceSubjectCourse($user),
                    'profile_picture'   => $this->faceSubjectProfilePicture($user),
                    'similarity'        => round((float) ($match['Similarity'] ?? 0), 2),
                    'confidence'        => round((float) data_get($match, 'Face.Confidence', 0), 2),
                    'external_image_id' => $externalImageId,
                ];
            })
            ->filter(fn (array $m) => filled($m['user_id']))
            ->values()
            ->all();

        return [
            'status'  => count($matches) > 0 ? 'matched' : 'no_matches',
            'matches' => $matches,
            'message' => count($matches) > 0 ? null : 'No close student matches were found.',
        ];
    }

    private function resolveUserFromExternalImageId(?string $externalImageId): User|Student|null
    {
        if (! is_string($externalImageId) || ! str_starts_with($externalImageId, 'student:')) {
            return null;
        }

        $ids = $this->parseStudentExternalImageId($externalImageId);

        if ($ids['user_id']) {
            $user = User::with('studentRecord')->find($ids['user_id']);
            if ($user) return $user;
        }

        return Student::find($ids['student_id']) ?? User::with('studentRecord')->find($ids['student_id']);
    }

    private function parseStudentExternalImageId(string $externalImageId): array
    {
        preg_match('/^student:(\d+)(?::user:(\d+))?$/', $externalImageId, $matches);

        return [
            'student_id' => (int) ($matches[1] ?? 0),
            'user_id'    => isset($matches[2]) ? (int) $matches[2] : null,
        ];
    }

    private function faceSubjectStudentRecordId(User|Student|null $subject): ?int
    {
        if ($subject instanceof Student) {
            return $subject->id;
        }

        return $subject?->student_record_id ?: $subject?->studentRecord?->id ?: $subject?->id;
    }

    private function faceSubjectAccountUserId(User|Student|null $subject): ?int
    {
        if ($subject instanceof User) {
            return $subject->id;
        }

        return $subject?->userAccount?->id;
    }

    private function faceSubjectName(User|Student|null $subject): ?string
    {
        if (! $subject) return null;

        if ($subject instanceof Student) {
            return trim("{$subject->first_name} {$subject->last_name}") ?: null;
        }

        return $subject->name;
    }

    private function faceSubjectStudentNo(User|Student|null $subject): ?string
    {
        return $subject instanceof Student
            ? $subject->student_no
            : $subject?->student_id;
    }

    private function faceSubjectCourse(User|Student|null $subject): ?string
    {
        return $subject instanceof Student
            ? $subject->course
            : $subject?->course;
    }

    private function faceSubjectProfilePicture(User|Student|null $subject): ?string
    {
        return $subject instanceof Student
            ? $subject->photo_url
            : $subject?->profile_picture;
    }

    private function resolveImageBytes(string $path): ?string
    {
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $this->fetchUrlBytes($path);
        }

        $fullPath = storage_path('app/public/' . $path);

        if (file_exists($fullPath) && is_readable($fullPath)) {
            $handle = fopen($fullPath, 'rb');
            if ($handle) {
                $contents = fread($handle, filesize($fullPath));
                fclose($handle);
                return $contents !== false && $contents !== '' ? $contents : null;
            }
        }

        $url = asset('storage/' . ltrim($path, '/'));
        return $this->fetchUrlBytes($url);
    }

    private function fetchUrlBytes(string $url): ?string
    {
        $verifySsl = ! app()->environment(['local', 'development']);

        $context = stream_context_create([
            'http' => [
                'timeout'         => 10,
                'follow_location' => true,
            ],
            'ssl' => [
                'verify_peer'      => $verifySsl,
                'verify_peer_name' => $verifySsl,
            ],
        ]);

        $bytes = @file_get_contents($url, false, $context);
        return ($bytes !== false && $bytes !== '') ? $bytes : null;
    }

    private function readDiskBytes(string $disk, string $path): string
    {
        $bytes = $this->resolveImageBytes($path);

        if ($bytes === null) {
            throw new InvalidArgumentException("Unable to read image from [{$disk}:{$path}].");
        }

        return $bytes;
    }

    private function client(): RekognitionClient
    {
        return $this->clientInstance ??= new RekognitionClient([
            'version'     => 'latest',
            'region'      => $this->config['region'],
            'credentials' => [
                'key'    => $this->config['key'],
                'secret' => $this->config['secret'],
            ],
        ]);
    }

    private function collectionId(): string
    {
        return (string) $this->config['collection'];
    }

    private function ensureCollectionExists(): void
    {
        try {
            $this->client()->describeCollection([
                'CollectionId' => $this->collectionId(),
            ]);
        } catch (AwsException $e) {
            if ($e->getAwsErrorCode() === 'ResourceNotFoundException') {
                $this->client()->createCollection([
                    'CollectionId' => $this->collectionId(),
                    'Tags'         => [
                        'Application' => 'Sinag-Bughaw',
                        'Institution' => 'NU Lipa',
                    ],
                ]);
            } else {
                throw $e;
            }
        }
    }

    private function deleteExistingStudentFaces(User $user): int
    {
        $user->loadMissing('studentRecord');

        $studentIds = collect([
            $user->student_record_id,
            $user->studentRecord?->id,
            $user->id,
        ])
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $faceIds = [];
        $nextToken = null;

        try {
            do {
                $params = [
                    'CollectionId' => $this->collectionId(),
                    'MaxResults'   => 1000,
                ];

                if ($nextToken) {
                    $params['NextToken'] = $nextToken;
                }

                $result = $this->client()->listFaces($params);

                foreach ($result['Faces'] ?? [] as $face) {
                    $externalImageId = (string) ($face['ExternalImageId'] ?? '');

                    if (! str_starts_with($externalImageId, 'student:')) {
                        continue;
                    }

                    $ids = $this->parseStudentExternalImageId($externalImageId);
                    $sameUser = $ids['user_id'] && (int) $ids['user_id'] === (int) $user->id;
                    $sameStudent = in_array((int) $ids['student_id'], $studentIds, true);

                    if (($sameUser || $sameStudent) && filled($face['FaceId'] ?? null)) {
                        $faceIds[] = $face['FaceId'];
                    }
                }

                $nextToken = $result['NextToken'] ?? null;
            } while ($nextToken);

            foreach (array_chunk(array_unique($faceIds), 100) as $chunk) {
                $this->client()->deleteFaces([
                    'CollectionId' => $this->collectionId(),
                    'FaceIds'      => $chunk,
                ]);
            }
        } catch (AwsException $e) {
            Log::warning('[Rekognition] Could not delete old student faces before re-indexing.', [
                'user_id' => $user->id,
                'error'   => $e->getMessage(),
            ]);

            return 0;
        }

        return count(array_unique($faceIds));
    }

    private function faceIndexProfilePicture(User $user): ?string
    {
        $user->loadMissing('studentRecord');

        return $user->studentRecord?->photo
            ?: $user->getRawOriginal('profile_picture')
            ?: $user->profile_picture;
    }

    private function externalImageId(User $user): string
    {
        $user->loadMissing('studentRecord');

        $studentId = $user->student_record_id ?: $user->studentRecord?->id ?: $user->id;

        return "student:{$studentId}:user:{$user->id}";
    }
}
