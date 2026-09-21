<?php

use App\Http\Controllers\API\Payment\PaymentController;
use App\Http\Controllers\API\Auth\AuthController;
use App\Http\Controllers\API\AI\FaceRecognitionController;
use App\Http\Controllers\API\AI\TranscriptController;
use App\Http\Controllers\API\AI\VoiceNoteController;
use App\Http\Controllers\API\Admin\VoiceNoteAdminController;
use App\Http\Controllers\API\Admin\AdminAuthController;
use App\Http\Controllers\API\Admin\AdminController;
use App\Http\Controllers\API\Admin\UserManagementController;
use App\Http\Controllers\API\Admin\MediaModerationController;
use App\Http\Controllers\API\Admin\BatchSectionController;
use App\Http\Controllers\API\Admin\PrivacyConsentController;
use App\Http\Controllers\API\Admin\SubscriptionController;
use App\Http\Controllers\API\Admin\AnalyticsAdminController;
use App\Http\Controllers\API\Admin\ReportsController;
use App\Http\Controllers\API\Admin\SettingsController;
use App\Http\Controllers\API\Admin\GraduationContentController;
use App\Http\Controllers\API\Admin\FacultyAdminController;
use App\Http\Controllers\API\Admin\TrashController;
use App\Http\Controllers\API\Admin\SuperAdminController;
use App\Http\Controllers\API\Admin\StudentController as AdminStudentController;
use App\Http\Controllers\API\Admin\AnnouncementController as AdminAnnouncementController;
use App\Http\Controllers\API\Analytics\AnalyticsController;
use App\Http\Controllers\API\Auth\ConsentController;
use App\Http\Controllers\API\Feed\FeedController;
use App\Http\Controllers\API\Section\BatchController;
use App\Http\Controllers\API\Faculty\FacultyController;
use App\Http\Controllers\API\Search\SearchController;
use App\Http\Controllers\API\Section\SectionController;
use App\Http\Controllers\API\Section\DiscoveryStudentController;
use App\Http\Controllers\API\Social\MessageController;
use App\Http\Controllers\API\Social\NotificationController;
use App\Http\Controllers\API\Student\ProfileSettingsController;
use App\Http\Controllers\API\Student\ProfileController;
use App\Http\Controllers\API\Student\StudentController;
use App\Http\Controllers\API\Yearbook\AnnouncementController;
use App\Http\Controllers\API\Yearbook\GalleryController;
use App\Http\Controllers\API\Yearbook\GraduationController;
use App\Http\Controllers\API\Yearbook\MediaController;
use App\Http\Controllers\API\Yearbook\YearbookController;
use App\Http\Controllers\API\Yearbook\YearbookPdfController;
use App\Http\Controllers\API\Social\PresenceController;
use App\Http\Controllers\API\AI\MemoryController;
use App\Http\Controllers\API\Alumni\AlumniTrackerController;
use App\Http\Controllers\API\AppConfigController;
use App\Http\Controllers\BillingController;
use Illuminate\Support\Facades\Route;

// PUBLIC ROUTES

Route::get('/app-config', [AppConfigController::class, 'show']);

Route::prefix('auth')->group(function () {
    Route::post('/login',            [AuthController::class, 'login']);
    Route::post('/register',         [AuthController::class, 'register']);
    Route::post('/verify-student',   [AuthController::class, 'verifyStudent']);
    Route::post('/otp/send',         [AuthController::class, 'sendOtp']);
    Route::post('/otp/verify',       [AuthController::class, 'verifyOtp']);
    Route::post('/forgot-password',  [AuthController::class, 'forgotPassword']);
    Route::post('/otp/verify-reset', [AuthController::class, 'verifyResetOtp']);
    Route::post('/reset-password',   [AuthController::class, 'resetPassword']);
});

Route::post('/payments/webhook',    [PaymentController::class, 'webhook']);
Route::post('/paymongo/webhook',    [PaymentController::class, 'webhook']);
Route::get('/announcements',        [AnnouncementController::class, 'index']);
Route::get('/analytics/top-viewed', [AnalyticsController::class,   'topViewed']);
Route::post('/analytics/record-view/{userId}', [AnalyticsController::class, 'recordView']);

// Faculty (public no login required)
Route::prefix('faculty')->group(function () {
    Route::get('/',              [FacultyController::class, 'index']);
    Route::get('/by-department', [FacultyController::class, 'byDepartment']);
    Route::get('/{id}',          [FacultyController::class, 'show']);
});

Route::get('/albums-with-photos', [MediaModerationController::class, 'allAlbumsWithPhotos']);

Route::get('/yearbook/export/mobile-pdf/{batchId}', [YearbookPdfController::class, 'mobileExport'])
    ->middleware(['throttle:60,1', 'content.security', 'feature:enable_yearbook_pdf_download'])
    ->name('yearbook.export.mobile-pdf');

// PROTECTED ROUTES (auth:sanctum + throttle 120 req/min)


Route::middleware(['auth:sanctum', 'active.account', 'verified', 'throttle:120,1'])->group(function () {

    // Auth 
    Route::prefix('auth')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/me',      [AuthController::class, 'me']);
    });

    // Consent 
    Route::prefix('consent')->group(function () {
        Route::post('/accept', [ConsentController::class, 'accept']);
        Route::get('/status',  [ConsentController::class, 'status']);
    });

    // Feed 
    Route::get('/feed', [FeedController::class, 'index']);
    Route::post('/feed/{photo}/view', [FeedController::class, 'recordView']);

    // Profile 
    Route::prefix('profile')->group(function () {
        Route::post('/visibility',  [ProfileSettingsController::class, 'updateVisibility']);
        Route::post('/motto',       [ProfileSettingsController::class, 'updateMotto']);
        Route::put('/academic',     [ProfileSettingsController::class, 'updateAcademic']);
        Route::put('/achievements', [ProfileSettingsController::class, 'updateAchievements']);
        Route::get('/achievements', [ProfileSettingsController::class, 'getAchievements']);

        Route::get('/storage-usage',      [ProfileController::class, 'storageUsage']);
        Route::post('/upload',            [ProfileController::class, 'uploadMedia'])
            ->middleware('feature:allow_student_posts');
        Route::get('/posts/{photoId}',    [ProfileController::class, 'getPost']);
        Route::patch('/posts/{photoId}',  [ProfileController::class, 'updatePost']);
        Route::post('/posts/{photoId}/report', [ProfileController::class, 'reportPost']);
        Route::delete('/posts/{photoId}', [ProfileController::class, 'deletePost']);
    });

    //  Students
    Route::prefix('students')->group(function () {
        Route::get('/', [StudentController::class, 'index']);

        Route::post('/profile/bio',   [StudentController::class, 'updateBio']);
        Route::post('/profile/photo', [StudentController::class, 'updatePhoto']);
        Route::put('/profile/password', [StudentController::class, 'updatePassword']);

        Route::post('/profile/tagged-photos', [StudentController::class, 'tagStudentsOnPost']);
        Route::post('/profile/tagged-photos/upload', [StudentController::class, 'addTaggedPhoto']);
        Route::delete('/profile/tagged-photos/{photoId}', [StudentController::class, 'removeTaggedPhoto']);

        Route::middleware('subscription.access')
            ->get('/{id}/posts', [ProfileController::class, 'getPosts']);

        Route::middleware(['visibility', 'subscription.access'])->group(function () {
            Route::get('/{id}',               [StudentController::class, 'show']);
            Route::get('/{id}/achievements',  [StudentController::class, 'achievements']);
            Route::get('/{id}/tagged-photos', [StudentController::class, 'taggedPhotos']);
        });

        Route::post('/{id}/view', [ProfileSettingsController::class, 'trackView']);
    });

    // Sections 
    Route::prefix('sections')->group(function () {
        Route::get('/',     [SectionController::class, 'index']);
        Route::get('/{id}', [SectionController::class, 'show']);
    });

    // Batches 
    Route::prefix('batches')->group(function () {
        Route::get('/',                 [BatchController::class, 'index']);
        Route::get('/{batch}',          [BatchController::class, 'show']);
        Route::get('/{batch}/students', [BatchController::class, 'students']);
    });

    //  Discovery
    Route::get('/batchmates', [BatchController::class, 'batchmates']);

    Route::prefix('discover')->group(function () {
        Route::get('/sectionmates',            [BatchController::class, 'sectionmates']);
        Route::get('/school',                  [BatchController::class, 'wholeSchool']);
        Route::get('/cross-program',           [BatchController::class, 'crossProgram']);
        Route::get('/department/{department}', [BatchController::class, 'byDepartment']);
        Route::get('/students/{id}',           [DiscoveryStudentController::class, 'show']);
    });

    // Gallery
    Route::middleware('content.security')->prefix('gallery')->group(function () {
        Route::get('/',                   [GalleryController::class, 'index']);
        Route::get('/albums',             [GalleryController::class, 'listAlbums']);
        Route::post('/albums',            [GalleryController::class, 'storeAlbum']);
        Route::post('/face-search',       [GalleryController::class, 'faceSearch']);
        Route::delete('/media/{mediaId}', [GalleryController::class, 'destroyMedia']);
        Route::get('/{id}',               [GalleryController::class, 'show']);
    });

    // Search 
    Route::get('/search', [SearchController::class, 'search']);

    Route::prefix('search/students')->middleware('feature:enable_student_directory_search')->group(function () {
        Route::get('/suggest', [SearchController::class, 'suggest']);
        Route::get('/filters', [SearchController::class, 'studentFilters']);
        Route::get('/',        [SearchController::class, 'students']);
    });

    // Face Recognition 
    Route::prefix('face')->group(function () {
        Route::post('/sync',                    [FaceRecognitionController::class, 'syncStudents']);
        Route::post('/search',                  [FaceRecognitionController::class, 'search']);
        Route::get('/photos/{photo}/tags',       [FaceRecognitionController::class, 'photoTags']);
        Route::post('/photos/{photo}/analyze',   [FaceRecognitionController::class, 'analyzePhoto']);
        Route::post('/albums/{albumId}/analyze', [FaceRecognitionController::class, 'analyzeAlbum']);
        Route::get('/students/{userId}/photos',  [FaceRecognitionController::class, 'studentPhotos']);
    });

    // Messages 
    Route::prefix('messages')->group(function () {
        Route::get('/conversations', [MessageController::class, 'conversations']);
        Route::get('/unread-count',  [MessageController::class, 'unreadCount']);
        Route::get('/users/{userId}', [MessageController::class, 'participant']);
        Route::post('/typing',       [MessageController::class, 'typing']);
        Route::post('/',             [MessageController::class, 'send']);
        Route::get('/{userId}',      [MessageController::class, 'thread']);
        Route::patch('/{id}/read',   [MessageController::class, 'markRead']);
    });

    // Presence 
    Route::prefix('presence')->group(function () {
        Route::post('/',     [PresenceController::class, 'update']);
        Route::post('/bulk', [PresenceController::class, 'bulk']);
    });

    // Voice Notes 
    Route::prefix('voice-notes')->group(function () {
        Route::get('/inbox',            [VoiceNoteController::class, 'inbox']);
        Route::get('/outbox',           [VoiceNoteController::class, 'outbox']);
        Route::get('/profile/{userId}', [VoiceNoteController::class, 'forProfile']);
        Route::post('/',                [VoiceNoteController::class, 'store']);
        Route::delete('/{id}',          [VoiceNoteController::class, 'destroy']);
    });

    // Admin: Voice Note Moderation
    Route::middleware('can:admin')->prefix('admin/voice-notes')->group(function () {
        Route::get('/',              [VoiceNoteAdminController::class, 'index']);
        Route::get('/stats',         [VoiceNoteAdminController::class, 'stats']);
        Route::post('/{id}/approve', [VoiceNoteAdminController::class, 'approve']);
        Route::post('/{id}/reject',  [VoiceNoteAdminController::class, 'reject']);
    });

    // Graduation 
    Route::middleware('content.security')->prefix('graduation')->group(function () {
        Route::get('/',                   [GraduationController::class, 'index']);
        Route::get('/album',              [GraduationController::class, 'index']);
        Route::post('/album',             [GraduationContentController::class, 'createAlbum']);
        Route::post('/upload-photo',      [GraduationContentController::class, 'uploadPhotos']);
        Route::post('/upload-video',      [GraduationContentController::class, 'uploadVideo']);
        Route::post('/upload-program',    [GraduationContentController::class, 'uploadProgram']);
        Route::post('/upload-invitation', [GraduationContentController::class, 'uploadInvitation']);
        Route::post('/upload-song',       [GraduationContentController::class, 'uploadSong']);
        Route::post('/upload-mass',       [GraduationContentController::class, 'uploadMass']);
        Route::get('/{id}',               [GraduationController::class, 'show'])->where('id', '[0-9]+');
        Route::delete('/{id}',            [GraduationController::class, 'destroy'])->where('id', '[0-9]+');
    });

    // Media 
    Route::middleware('content.security')->prefix('media')->group(function () {
        Route::post('/bulk-upload',  [MediaController::class, 'bulkUpload']);
        Route::post('/upload-video', [MediaController::class, 'uploadVideo']);
        Route::delete('/photo/{id}', [MediaController::class, 'deletePhoto']);
    });

    // Yearbook — list/search remain open; flipbook content requires Standard+
    Route::prefix('yearbook')->group(function () {
        Route::get('/flipbook', [YearbookController::class, 'flipbookData'])
            ->middleware(['standard', 'feature:enable_flipbook_viewer']);
        Route::get('/export/{userId}',        [YearbookController::class,      'exportStudentPdf'])
            ->middleware('standard');
        Route::get('/search',                 [YearbookController::class,      'search']);
        Route::get('/bookmarks/{batchId}',    [YearbookController::class,      'getBookmarks'])
            ->middleware('standard');
        Route::post('/bookmark',              [YearbookController::class,      'addBookmark'])
            ->middleware('standard');
        Route::delete('/bookmark/{bookmark}', [YearbookController::class,      'removeBookmark'])
            ->middleware('standard');
        Route::get('/alumni-from-page',       [AlumniTrackerController::class, 'fromYearbookPage'])
            ->name('yearbook.alumni-from-page');
    });

    // Yearbooks (batch-scoped)
    Route::middleware('content.security')->prefix('yearbooks')->group(function () {
        Route::get('{batch}', [YearbookController::class, 'show'])
            ->name('yearbooks.show');
        Route::get('{batch}/pages', [YearbookController::class, 'pages'])
            ->middleware(['standard', 'feature:enable_flipbook_viewer'])
            ->name('yearbooks.pages');
        Route::get('{batch}/galleries',           [GalleryController::class,  'index'])
            ->name('yearbooks.galleries.index');
        Route::get('{batch}/galleries/{gallery}', [GalleryController::class,  'show'])
            ->name('yearbooks.galleries.show');
        Route::post('{batch}/photos',             [YearbookController::class, 'uploadPhoto'])
            ->middleware(['standard', 'throttle:20,1'])
            ->name('yearbooks.photos.upload');
        Route::post('{batch}/generate',           [YearbookController::class, 'generate'])
            ->middleware(['standard', 'throttle:20,1', 'feature:enable_flipbook_viewer'])
            ->name('yearbooks.generate');
    });

    Route::get('galleries/{gallery}', [GalleryController::class, 'show'])
        ->name('galleries.show');

    // Payments 
    Route::prefix('payments')->group(function () {
        Route::post('/create-intent', [PaymentController::class, 'createIntent'])
            ->middleware('feature:enable_premium_subscription');
        Route::post('/confirm',       [PaymentController::class, 'confirm'])
            ->middleware('feature:enable_premium_subscription');
        Route::get('/history',        [PaymentController::class, 'history']);
        Route::get('/status',         [PaymentController::class, 'subscriptionStatus']);
    });

    // Billing / checkout aliases (JSON by default for API clients)
    Route::prefix('billing')->middleware('feature:enable_premium_subscription')->group(function () {
        Route::match(['get', 'post'], '/', [BillingController::class, 'checkout']);
        Route::match(['get', 'post'], '/checkout', [BillingController::class, 'checkout']);
    });

    // Notifications 
    Route::prefix('notifications')->group(function () {
        Route::get('/',                [NotificationController::class, 'index']);
        Route::post('/register-token', [NotificationController::class, 'registerToken']);
        Route::post('/read-all',       [NotificationController::class, 'markAll']);
        Route::post('/{id}/read',      [NotificationController::class, 'markRead']);
    });

    // Announcements 
    Route::get('/announcements/recipients/count', [AdminAnnouncementController::class, 'recipientCount']);
    Route::post('/announcements', [AdminAnnouncementController::class, 'store']);
    Route::put('/announcements/{announcement}', [AdminAnnouncementController::class, 'update']);
    Route::delete('/announcements/{announcement}', [AdminAnnouncementController::class, 'destroy']);

    // Analytics
    Route::prefix('analytics')->group(function () {
        Route::get('/summary',        [AnalyticsController::class, 'summary']);
        Route::get('/trending',       [AnalyticsController::class, 'trending']);
        Route::get('/my-stats',       [AnalyticsController::class, 'myStats']);
        Route::get('/my-stats/trend', [AnalyticsController::class, 'myStatsTrend']);
        Route::get('/batchmates',     [AnalyticsController::class, 'batchmates']);
        Route::post('/record-view/{userId}', [AnalyticsController::class, 'recordView']);
        Route::post('/record-content-view', [AnalyticsController::class, 'recordContentView']);
    });

    // Memory Digest 
    Route::get('/dashboard/memory-digest', [MemoryController::class, 'digest']);
    Route::prefix('memories')->group(function () {
        Route::get('/digest',      [MemoryController::class, 'digest']);
        Route::get('/on-this-day', [MemoryController::class, 'onThisDay']);
    });

    // Alumni Tracker
    Route::prefix('alumni')->group(function () {
        Route::get('/me',                 [AlumniTrackerController::class, 'me']);
        Route::post('/career',            [AlumniTrackerController::class, 'updateCareer']);
        Route::get('/search',             [AlumniTrackerController::class, 'search']);
        Route::get('/from-yearbook-page', [AlumniTrackerController::class, 'fromYearbookPage'])
            ->name('alumni.from-yearbook-page');
        Route::get('/',                   [AlumniTrackerController::class, 'index']);
        Route::get('/batch/{batchId}',    [AlumniTrackerController::class, 'byBatch']);
        Route::get('/{id}',               [AlumniTrackerController::class, 'show']);
        Route::get('/{id}/yearbook-entry',[AlumniTrackerController::class, 'yearbookEntry'])
            ->name('alumni.yearbook-entry');
    });

    Route::prefix('graduation')->group(function () {
        Route::get('/',            [GraduationController::class, 'index']);
        Route::get('/{id}',        [GraduationController::class, 'show']);
        Route::get('/{id}/photos', [GraduationController::class, 'photos']);
    });

    Route::prefix('transcripts')->group(function () {
        Route::get('/',               [TranscriptController::class, 'index']);
        Route::post('/',              [TranscriptController::class, 'store']);
        Route::get('/{id}',           [TranscriptController::class, 'show']);
        Route::delete('/{id}',        [TranscriptController::class, 'destroy']);
        Route::get('/{id}/subtitles', [TranscriptController::class, 'subtitles']);
        Route::post('/{id}/notes',    [TranscriptController::class, 'regenerateNotes']);
    });

    // PREMIUM-ONLY ROUTES
    Route::middleware('premium')->group(function () {

        Route::get('/yearbook/certificate', [YearbookController::class, 'exportCertificate']);

    });

    // STANDARD/PREMIUM YEARBOOK PDF DOWNLOADS
    Route::middleware('standard')->group(function () {

        // Bumped from throttle:5,1 throttle:60,1 for development
        Route::get('/yearbook/export/pdf/{batchId}', [YearbookPdfController::class, 'export'])
            ->middleware(['throttle:60,1', 'content.security', 'feature:enable_yearbook_pdf_download'])
            ->name('yearbook.export.pdf');

        Route::get('yearbooks/{batch}/download', [YearbookController::class, 'download'])
            ->middleware(['throttle:5,1', 'content.security', 'feature:enable_yearbook_pdf_download'])
            ->name('yearbooks.download');

    });
});

// ADMIN ROUTES Admin model + admin-token, fully separate from user auth


Route::prefix('admin')->group(function () {
    Route::post('/login', [AdminAuthController::class, 'login']);
    Route::post('/login/totp', [AdminAuthController::class, 'verifyTotp'])
        ->middleware('throttle:10,1');
});

Route::middleware(['auth:sanctum', 'active.account', 'admin.only'])
    ->prefix('admin')
    ->group(function () {

    // Auth
    Route::post('/logout', [AdminAuthController::class, 'logout']);
    Route::get('/me',      [AdminAuthController::class, 'me']);

    // Dashboard
    Route::get('/dashboard', [AdminController::class, 'dashboard']);

    // Students
    Route::get('/students',         [StudentController::class, 'index']);
    Route::get('/students/{id}',    [StudentController::class, 'show']);
    Route::delete('/students/{id}', [AdminController::class,   'deleteStudent']);

    // Faculty CRUD
    Route::get('/faculty',         [FacultyAdminController::class, 'index']);
    Route::post('/faculty',        [FacultyAdminController::class, 'store']);
    Route::post('/faculty/import-csv', [FacultyAdminController::class, 'importCsv']);
    Route::put('/faculty/{id}',    [FacultyAdminController::class, 'update']);
    Route::delete('/faculty/{id}', [FacultyAdminController::class, 'destroy']);

    // Gallery & Media 
    Route::get('/gallery',             [GalleryController::class, 'index']);
    Route::post('/gallery',            [GalleryController::class, 'store']);
    Route::delete('/gallery/{id}',     [GalleryController::class, 'destroy']);
    Route::delete('/media/photo/{id}', [MediaController::class,   'deletePhoto']);

    // Batches & Sections
    Route::get('/batches',         [BatchController::class,   'index']);
    Route::get('/batches/{batch}', [BatchController::class,   'show']);
    Route::get('/sections',        [SectionController::class, 'index']);

    // Analytics 
    Route::get('/analytics/summary',  [AnalyticsController::class, 'summary']);
    Route::get('/analytics/trending', [AnalyticsController::class, 'trending']);

    // User Management
    Route::prefix('users')->group(function () {
        Route::get('/',                       [UserManagementController::class, 'index']);
        Route::get('/{user}',                 [UserManagementController::class, 'show']);
        Route::patch('/{user}',               [UserManagementController::class, 'update']);
        Route::patch('/{user}/suspend',       [UserManagementController::class, 'suspend']);
        Route::patch('/{user}/unsuspend',     [UserManagementController::class, 'unsuspend']);
        Route::patch('/{user}/verify',        [UserManagementController::class, 'verify']);
        Route::post('/{user}/reset-password', [UserManagementController::class, 'resetPassword']);
        Route::delete('/{user}',              [UserManagementController::class, 'destroy']);
    });

    // Moderation 
    Route::prefix('moderation')->group(function () {

        Route::get('queue',  [MediaModerationController::class, 'queue']);
        Route::get('counts', [MediaModerationController::class, 'counts']);

        Route::post('bulk-approve', [MediaModerationController::class, 'bulkApprove']);
        Route::post('bulk-reject',  [MediaModerationController::class, 'bulkReject']);

        Route::get('history/{type}/{id}', [MediaModerationController::class, 'statusHistory']);

        Route::post('photo/album/{albumId}/approve', [MediaModerationController::class, 'approveAlbum']);
        Route::post('photo/album/{albumId}/reject',  [MediaModerationController::class, 'rejectAlbum']);
        Route::post('photo/album/{albumId}/revert',  [MediaModerationController::class, 'revertAlbum']);

        Route::post('photo/{id}/approve', [MediaModerationController::class, 'approvePhoto']);
        Route::post('photo/{id}/reject',  [MediaModerationController::class, 'rejectPhoto']);
        Route::post('photo/{id}/revert',  [MediaModerationController::class, 'revertPhoto']);
        Route::post('photo/{id}/flag-avatar', [MediaModerationController::class, 'flagAvatar']);

        Route::get( '{type}/{id}',         [MediaModerationController::class, 'show']);
        Route::post('{type}/{id}/approve', [MediaModerationController::class, 'approveItem']);
        Route::post('{type}/{id}/reject',  [MediaModerationController::class, 'rejectItem']);
        Route::post('{type}/{id}/revert',  [MediaModerationController::class, 'revertItem']);
    });

    // Voice Notes Moderation 
    Route::get('/voice-notes',               [VoiceNoteAdminController::class, 'index']);
    Route::get('/voice-notes/stats',         [VoiceNoteAdminController::class, 'stats']);
    Route::post('/voice-notes/{id}/approve', [VoiceNoteAdminController::class, 'approve']);
    Route::post('/voice-notes/{id}/reject',  [VoiceNoteAdminController::class, 'reject']);

    // Batches 
    Route::prefix('batches')->group(function () {
        Route::get('/',           [BatchSectionController::class, 'batchIndex']);
        Route::get('/{batch}',    [BatchSectionController::class, 'batchShow']);
        Route::post('/',          [BatchSectionController::class, 'batchStore']);
        Route::put('/{batch}',    [BatchSectionController::class, 'batchUpdate']);
        Route::delete('/{batch}', [BatchSectionController::class, 'batchDestroy']);

        Route::get('/{batch}/departments',                      [BatchSectionController::class, 'batchDepartments']);
        Route::get('/{batch}/departments/{department}/courses', [BatchSectionController::class, 'batchDepartmentCourses']);
    });

    // Sections 
    Route::prefix('sections')->group(function () {
        Route::get('/',             [BatchSectionController::class, 'sectionIndex']);
        Route::get('/{section}',    [BatchSectionController::class, 'sectionShow']);
        Route::post('/',            [BatchSectionController::class, 'sectionStore']);
        Route::put('/{section}',    [BatchSectionController::class, 'sectionUpdate']);
        Route::delete('/{section}', [BatchSectionController::class, 'sectionDestroy']);

        Route::get('/{section}/students',         [AdminStudentController::class, 'index']);
        Route::post('/{section}/students/create', [AdminStudentController::class, 'store']);
        Route::post('/{section}/students/import', [AdminStudentController::class, 'import']);
        Route::put('/{section}/students/{student}',    [AdminStudentController::class, 'update']);
        Route::delete('/{section}/students/{student}', [AdminStudentController::class, 'destroy']);
    });

    //Media Library 
    Route::prefix('media')->group(function () {
        Route::get('/stats', [MediaModerationController::class, 'mediaStats']);

        Route::get('/albums',         [MediaModerationController::class, 'mediaAlbums']);
        Route::post('/albums',        [MediaModerationController::class, 'storeAlbum']);
        Route::put('/albums/{id}',    [MediaModerationController::class, 'updateAlbum']);
        Route::delete('/albums/{id}', [MediaModerationController::class, 'destroyAlbum']);

        Route::get('/albums/{id}/photos', [MediaModerationController::class, 'albumPhotos']);

        Route::get('/photos',         [MediaModerationController::class, 'mediaPhotos']);
        Route::patch('/photos/{id}/visibility', [MediaModerationController::class, 'updatePhotoVisibility']);
        Route::delete('/photos/{id}', [MediaModerationController::class, 'destroyPhoto']);

        Route::get('/videos',         [MediaModerationController::class, 'mediaVideos']);
        Route::delete('/videos/{id}', [MediaModerationController::class, 'destroyVideo']);

        Route::get('/voice-notes',           [MediaModerationController::class, 'mediaVoiceNotes']);
        Route::delete('/voice-notes/{id}',   [MediaModerationController::class, 'destroyVoiceNote']);

        Route::get('/tagged-photos',         [MediaModerationController::class, 'mediaTaggedPhotos']);
        Route::delete('/tagged-photos/{id}', [MediaModerationController::class, 'destroyTaggedPhoto']);
    });

    // Graduation Content 
    Route::prefix('graduation/content')->group(function () {
        $gc = GraduationContentController::class;

        Route::get('/stats',   [$gc, 'stats']);
        Route::get('/',        [$gc, 'index']);
        Route::get('/{album}', [$gc, 'show']);
        Route::post('/',       [$gc, 'uploadContent']);

        Route::post('/photos',      [$gc, 'uploadPhotos']);
        Route::post('/toga',        [$gc, 'uploadToga']);
        Route::post('/highlights',  [$gc, 'uploadHighlights']);
        Route::post('/videos',      [$gc, 'uploadVideo']);
        Route::post('/songs',       [$gc, 'uploadSong']);
        Route::post('/mass',        [$gc, 'uploadMass']);
        Route::post('/speeches',    [$gc, 'uploadSpeech']);
        Route::post('/program',     [$gc, 'uploadProgram']);
        Route::post('/invitations', [$gc, 'uploadInvitation']);
        Route::post('/messages',    [$gc, 'uploadMessage']);
        Route::post('/archive',     [$gc, 'uploadArchive']);

        Route::patch('/files/{photo}',  [$gc, 'updatePhoto']);
        Route::delete('/files/{photo}', [$gc, 'destroyPhoto']);

        Route::put('/{album}',          [$gc, 'update']);
        Route::delete('/{album}',       [$gc, 'destroy']);
        Route::post('/{album}/publish', [$gc, 'publish']);
        Route::post('/{album}/archive', [$gc, 'archiveContent']);
    });

    // Graduation Albums 
    Route::prefix('graduation/albums')->group(function () {
        $gc = GraduationContentController::class;
        Route::post('/',               [$gc, 'createAlbum']);
        Route::post('/{album}/upload', [$gc, 'uploadToAlbum']);
    });

    // Privacy & Consent 
    Route::prefix('privacy')->group(function () {
        Route::get('/stats',      [PrivacyConsentController::class, 'stats']);
        Route::get('/consents',   [PrivacyConsentController::class, 'consents']);
        Route::get('/audit-logs', [PrivacyConsentController::class, 'auditLogs']);
    });

    // Subscriptions
    Route::prefix('subscriptions')->group(function () {
        Route::get('/stats',                   [SubscriptionController::class, 'stats']);
        Route::get('/',                        [SubscriptionController::class, 'index']);
        Route::get('/{subscription}',          [SubscriptionController::class, 'show']);
        Route::patch('/{subscription}/cancel', [SubscriptionController::class, 'cancel']);
    });

    // Analytics & Engagement 
    Route::prefix('analytics')->group(function () {
        Route::get('/overview',     [AnalyticsAdminController::class, 'overview']);
        Route::get('/views-trend',  [AnalyticsAdminController::class, 'viewsTrend']);
        Route::get('/top-profiles', [AnalyticsAdminController::class, 'topProfiles']);
        Route::get('/trending',     [AnalyticsAdminController::class, 'trending']);
        Route::get('/engagement',   [AnalyticsAdminController::class, 'engagement']);
        Route::get('/presence',     [AnalyticsAdminController::class, 'presence']);
    });

    // Trash 
    Route::prefix('trash')->group(function () {
        Route::get('/',              [TrashController::class, 'index']);
        Route::get('/counts',        [TrashController::class, 'counts']);
        Route::post('/bulk-restore', [TrashController::class, 'bulkRestore']);
        Route::delete('/bulk-force', [TrashController::class, 'bulkForce']);
        Route::post('/{type}/{id}/restore', [TrashController::class, 'restore']);
        Route::delete('/{type}/{id}',       [TrashController::class, 'forceDelete']);
    });

    // Settings 
    Route::prefix('settings')->group(function () {
        Route::get('/',                    [SettingsController::class, 'index']);
        Route::post('/',                   [SettingsController::class, 'save']);
        Route::delete('/clear-audit-logs', [SettingsController::class, 'clearAuditLogs']);
        Route::post('/reset',              [SettingsController::class, 'reset']);
        Route::post('/archive-batch',      [SettingsController::class, 'archiveBatch']);
    });
});


// SUPER ADMIN ROUTES

Route::middleware(['auth:sanctum', 'active.account', 'admin.only', 'require.super_admin'])
    ->prefix('admin')
    ->group(function () {

        Route::get   ('/admins',                    [SuperAdminController::class, 'index']);
        Route::post  ('/admins',                    [SuperAdminController::class, 'store']);
        Route::put   ('/admins/{id}',               [SuperAdminController::class, 'update']);
        Route::delete('/admins/{id}',               [SuperAdminController::class, 'destroy']);
        Route::patch ('/admins/{id}/toggle-status', [SuperAdminController::class, 'toggleStatus']);

        Route::prefix('reports')->group(function () {
            Route::get('/stats',         [ReportsController::class, 'stats']);
            Route::get('/audit-logs',    [ReportsController::class, 'auditLogs']);
            Route::get('/upload-logs',   [ReportsController::class, 'uploadLogs']);
            Route::get('/login-history', [ReportsController::class, 'loginHistory']);
            Route::get('/ai-logs',       [ReportsController::class, 'aiLogs']);
        });
    });
