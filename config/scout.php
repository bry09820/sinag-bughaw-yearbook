<?php

return [
    // `?:` so an empty SCOUT_DRIVER="" doesn't resolve to a "" driver (Manager::createDriver() crash).
    'driver' => env('SCOUT_DRIVER') ?: 'database',
    'prefix' => env('SCOUT_PREFIX', ''),
    'queue'  => env('SCOUT_QUEUE', true),

    'after_commit' => false,
    'soft_delete'  => false,
    'identify'     => env('SCOUT_IDENTIFY', false),

    'chunk' => [
        'searchable'   => 500,
        'unsearchable' => 500,
    ],

    'meilisearch' => [
        'host' => env('MEILISEARCH_HOST', 'http://localhost:7700'),
        'key'  => env('MEILISEARCH_KEY', null),

        'index-settings' => [
            'users' => [
                'searchableAttributes' => [
                    'name',
                    'student_id',
                    'email',
                    'course',
                    'course_short',
                    'section',
                    'batch_year',
                ],
                'filterableAttributes' => [
                    'course',
                    'course_short',
                    'batch_year',
                    'section',
                    'role',
                    'is_active',
                ],
                'sortableAttributes' => [
                    'name',
                    'batch_year',
                    'created_at',
                ],
                'rankingRules' => [
                    'words',
                    'typo',
                    'proximity',
                    'attribute',
                    'sort',
                    'exactness',
                ],
                'typoTolerance' => [
                    'enabled' => true,
                    'minWordSizeForTypos' => [
                        'oneTypo'  => 4,
                        'twoTypos' => 8,
                    ],
                ],
                'pagination' => [
                    'maxTotalHits' => 5000,
                ],
            ],
        ],
    ],
];