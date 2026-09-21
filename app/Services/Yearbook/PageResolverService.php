<?php

namespace App\Services\Yearbook;

use App\Models\Batch;
use App\Models\Album;
use App\Models\Faculty;
use App\Models\Section;
use App\Models\User;

class PageResolverService
{
    private const TOC_ENTRIES_PER_PAGE = 7;

    public function getPageIndex(
        int $userId,
        int $batchId,
        ?string $department = null,
        ?string $course = null
    ): int
    {
        Batch::findOrFail($batchId);

        $cursor = $this->preamblePageCount($batchId, $department, $course);

        $currentCourse = null;

        foreach ($this->sectionsForBatch($batchId, $department, $course) as $section) {
            $courseName = $this->courseNameForSection($section);
            if ($courseName !== $currentCourse) {
                $cursor++; // course-header
                $currentCourse = $courseName;
            }

            $cursor++; // section-header

            foreach ($section->students as $student) {
                if ((int) $student->id === $userId) {
                    return $cursor;
                }

                $cursor += 2; // student portrait + student details
            }
        }

        return 0; // fallback cover
    }

    /**
     * Returns the first student on a given yearbook page.
     */
    public function getUserAtPage(
        int $batchId,
        int $pageIndex,
        ?string $department = null,
        ?string $course = null
    ): ?User
    {
        $preamble = $this->preamblePageCount($batchId, $department, $course);

        if ($pageIndex < $preamble) {
            return null; // cover / dedication / toc
        }

        if (!Batch::find($batchId)) {
            return null;
        }

        $cursor = $preamble;

        $currentCourse = null;

        foreach ($this->sectionsForBatch($batchId, $department, $course) as $section) {
            $courseName = $this->courseNameForSection($section);
            if ($courseName !== $currentCourse) {
                $cursor++; // course-header
                $currentCourse = $courseName;
            }

            $cursor++; // section-header

            foreach ($section->students as $student) {
                if ($pageIndex === $cursor || $pageIndex === $cursor + 1) {
                    return User::with(['batchRecord', 'careerProfile'])
                        ->where('student_record_id', $student->id)
                        ->orWhere('id', $student->id)
                        ->first();
                }

                $cursor += 2;
            }
        }

        return null;
    }

    private function sectionsForBatch(int $batchId, ?string $department = null, ?string $course = null)
    {
        return Section::where('batch_id', $batchId)
            ->when($department, fn ($query) => $query->where('department', $department))
            ->when($course, fn ($query) => $query->where('course', $course))
            ->with(['students' => function ($q) {
                $q->select('id', 'first_name', 'last_name', 'section_id')
                    ->orderBy('last_name')
                    ->orderBy('first_name');
            }])
            ->orderBy('department')
            ->orderBy('course')
            ->orderBy('name')
            ->get();
    }

    private function preamblePageCount(int $batchId, ?string $department = null, ?string $course = null): int
    {
        $sectionQuery = Section::where('batch_id', $batchId)
            ->when($department, fn ($query) => $query->where('department', $department))
            ->when($course, fn ($query) => $query->where('course', $course));

        $sectionCount = (clone $sectionQuery)->count();
        $courseCount = (clone $sectionQuery)
            ->get(['course'])
            ->map(fn ($section) => $this->courseNameForSection($section))
            ->unique()
            ->count();

        $tocEntries = 11 + $courseCount + $sectionCount;

        if (Album::where('batch_id', $batchId)->exists()) {
            $tocEntries++;
        }

        if (Faculty::query()->exists()) {
            $tocEntries++;
        }

        $tocPageCount = max(2, (int) ceil($tocEntries / self::TOC_ENTRIES_PER_PAGE));
        if ($tocPageCount % 2 !== 0) {
            $tocPageCount++;
        }

        return 8 + $tocPageCount;
    }

    private function courseNameForSection($section): string
    {
        return $section->course ?: $section->strand ?: 'Course';
    }
}
