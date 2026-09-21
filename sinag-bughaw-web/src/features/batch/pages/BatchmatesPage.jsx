/**
 * BatchmatesPage.jsx Drill-down accordion pattern
 * Department Courses Sections Students
 */

import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useBatch } from '@/features/batch/hooks/useBatch';
import { batchApi } from '@/api/batch.api';
import { faceApi } from '@/api/gallery.api';
import FaceSearchButton from '@/components/ui/FaceSearchButton';
import { imageUrl } from '@/utils/imageUrl';
import { recordContentView } from '@/api/analytics.api';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR + 2 - i);

function getInitials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('');
}

function faceUserId(match) {
  const id = Number(match?.account_user_id ?? match?.user_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function studentUserId(student) {
  const id = Number(student?.account_user_id ?? student?.user_id ?? student?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function studentRecordId(student) {
  const id = Number(student?.student_record_id ?? student?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const COURSE_ALIASES = {
  'bachelor of science in architecture': ['bs architecture', 'architecture'],
  'bachelor of multimedia arts': ['bachelor of multimedia arts (bmma)', 'bmma', 'bma', 'multimedia arts'],
  'bachelor of science in civil engineering': ['bs civil engineering', 'civil engineering'],
  'bachelor of science in computer science': ['bs computer science', 'bscs', 'computer science'],
  'bachelor of science in information technology': ['bs information technology', 'bsit', 'information technology'],
  'bachelor of science in nursing': ['bs nursing', 'bsn', 'nursing'],
  'bachelor of science in medical technology': ['bs medical technology', 'bsmt', 'medical technology'],
  'bachelor of science in psychology': ['bs psychology', 'bsp', 'psychology'],
  'bachelor of science in accountancy': ['bs accountancy', 'bsa', 'accountancy'],
  'bachelor of science in business administration - financial management': ['bsba financial management', 'bsbafm', 'bsba-fm', 'financial management'],
  'bachelor of science in business administration - marketing management': ['bsba marketing management', 'bsbamm', 'bsba-mm', 'marketing management'],
  'bachelor of science in tourism management': ['bs tourism management', 'bbstm', 'bstm', 'tourism management'],
  'master in management': ['mm'],
  abm: ['accountancy business and management'],
  stem: ['science technology engineering mathematics'],
  humss: ['humanities and social sciences'],
};

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function includesSearch(value, query) {
  return normalizeText(value).includes(query);
}

function courseMatches(studentCourse, selectedCourse) {
  const selected = normalizeText(selectedCourse);
  if (!selected) return true;
  const course = normalizeText(studentCourse);
  const selectedAliases = COURSE_ALIASES[selected] ?? [];
  const courseAliases = COURSE_ALIASES[course] ?? [];
  const selectedTerms = [selected, ...selectedAliases];
  const courseTerms = [course, ...courseAliases];
  return selectedTerms.some(term => courseTerms.some(courseTerm =>
    courseTerm === term || courseTerm.includes(term) || term.includes(courseTerm)
  ));
}

function usableFaceMatches(matches = []) {
  const normalized = matches
    .map(m => ({
      ...m,
      user_id: faceUserId(m),
      student_record_id: m?.student_record_id ?? m?.student_id ?? null,
    }))
    .filter(m => m.user_id);
  const validMatches = normalized.filter(m => m.name || m.student_id || m.course || m.profile_picture);
  const source = validMatches.length ? validMatches : normalized;
  return Array.from(new Map(source.map(m => [m.user_id, m])).values());
}

// Drill-down breadcrumb
function Breadcrumb({ department, course, section, onClickDept, onClickCourse }) {
  if (!department) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 mb-5 flex-wrap">
      <button
        onClick={onClickDept}
        className="text-[#3f51b5] hover:underline cursor-pointer bg-transparent border-none p-0"
      >
        All Departments
      </button>
      <span>/</span>
      {course ? (
        <>
          <button
            onClick={onClickCourse}
            className="text-[#3f51b5] hover:underline cursor-pointer bg-transparent border-none p-0"
          >
            {department}
          </button>
          <span>/</span>
        </>
      ) : (
        <span className="text-[#1d2b4b]">{department}</span>
      )}
      {course && (
        section ? (
          <>
            <button
              onClick={onClickCourse}
              className="text-[#3f51b5] hover:underline cursor-pointer bg-transparent border-none p-0"
            >
              {course}
            </button>
            <span>/</span>
            <span className="text-[#1d2b4b]">Section {section}</span>
          </>
        ) : (
          <span className="text-[#1d2b4b]">{course}</span>
        )
      )}
    </div>
  );
}

// Chip button
function Chip({ label, active, onClick, count }) {
  return (
    <button
      onClick={onClick}
      className={`font-bold text-xs px-4 py-2 rounded-xl transition-all whitespace-nowrap border-[1.5px] cursor-pointer inline-flex items-center gap-1.5
        ${active
          ? 'bg-[#1d2b4b] text-white border-[#1d2b4b]'
          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
        }`}
    >
      {label}
      {count != null && (
        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full
          ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// Yearbook helpers
async function findYearbookBatchId(year, course = null) {
  if (!year) return null;
  const { data } = await batchApi.index();
  const raw = data?.data ?? data ?? [];
  const batches = Array.isArray(raw)
    ? raw
    : Object.values(raw).flatMap(group => Array.isArray(group) ? group : []);
  const sameYear = batches.filter(batch =>
    Number(batch.graduation_year ?? batch.year) === Number(year)
  );
  const normalizedCourse = String(course ?? '').trim().toLowerCase();
  const exactCourse = normalizedCourse
    ? sameYear.find(batch => String(batch.course ?? '').trim().toLowerCase() === normalizedCourse)
    : null;
  return (exactCourse ?? sameYear[0])?.id ?? null;
}

function GenerateYearbookButton({ year, department, course }) {
  const navigate = useNavigate();
  const [hov, setHov] = useState(false);
  const [opening, setOpening] = useState(false);
  const label = year ? `Generate Yearbook · Batch ${year}` : 'Generate Yearbook';

  const openYearbook = async () => {
    if (!year) { navigate('/yearbook'); return; }
    setOpening(true);
    try {
      const batchId = await findYearbookBatchId(year, course);
      const params = new URLSearchParams();
      if (department) params.set('department', department);
      if (course) params.set('course', course);
      navigate(batchId
        ? `/yearbook/${batchId}/view${params.toString() ? `?${params.toString()}` : ''}`
        : `/yearbook?year=${year}`);
    } catch {
      const params = new URLSearchParams({ year: String(year) });
      if (department) params.set('department', department);
      if (course) params.set('course', course);
      navigate(`/yearbook?${params.toString()}`);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      onClick={openYearbook}
      disabled={opening}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={`inline-flex items-center gap-2 px-[26px] py-[11px] rounded-full border-[1.5px] text-[0.78rem] font-extrabold tracking-wide whitespace-nowrap transition-all duration-200
        ${hov
          ? 'bg-[#fdb813] text-[#1d2b4b] border-[#fdb813] shadow-[0_8px_24px_rgba(253,184,19,0.35)] -translate-y-0.5'
          : 'bg-[rgba(253,184,19,0.12)] text-[#fdb813] border-[rgba(253,184,19,0.55)]'
        }
        ${opening ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
      {opening ? 'Opening Yearbook…' : label}
    </button>
  );
}

function YearbookFilterPill({ year, department, course }) {
  const navigate = useNavigate();
  const [hov, setHov] = useState(false);
  const [opening, setOpening] = useState(false);
  if (!year) return null;

  const openYearbook = async () => {
    setOpening(true);
    try {
      const batchId = await findYearbookBatchId(year, course);
      const params = new URLSearchParams();
      if (department) params.set('department', department);
      if (course) params.set('course', course);
      navigate(batchId
        ? `/yearbook/${batchId}/view${params.toString() ? `?${params.toString()}` : ''}`
        : `/yearbook?year=${year}`);
    } catch {
      const params = new URLSearchParams({ year: String(year) });
      if (department) params.set('department', department);
      if (course) params.set('course', course);
      navigate(`/yearbook?${params.toString()}`);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      onClick={openYearbook}
      disabled={opening}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={`Open ${year} Yearbook`}
      className={`inline-flex items-center gap-1.5 px-4 py-[9px] rounded-xl border-none text-[0.72rem] font-extrabold whitespace-nowrap transition-all duration-200
        ${hov
          ? 'bg-[#fdb813] text-[#1d2b4b] shadow-[0_4px_14px_rgba(253,184,19,0.3)]'
          : 'bg-[#1d2b4b] text-[#fdb813] shadow-[0_2px_8px_rgba(29,43,75,0.15)]'
        }
        ${opening ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
      {opening ? 'Opening…' : `Yearbook ${year}`}
    </button>
  );
}

function FaceResultBanner({ matches, onClear }) {
  if (!matches.length) return null;
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-4 px-4 py-3 rounded-2xl bg-amber-400/10 border border-amber-400/30 mx-[8%]">
      <div className="flex items-center gap-2">
        <div className="flex">
          {matches.slice(0, 3).map((m, i) => (
            <img
              key={m.user_id}
              src={imageUrl(m.profile_picture ?? m.photo) || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name ?? '')}&background=1d2b4b&color=fdb813`}
              alt={m.name}
              className="w-7 h-7 rounded-lg border-2 border-amber-400 object-cover"
              style={{ marginLeft: i > 0 ? '-7px' : 0 }}
            />
          ))}
        </div>
        <span className="text-[0.8rem] font-bold text-amber-700">
          <i className="fas fa-camera mr-1 text-amber-400" />
          {matches.length} face match{matches.length > 1 ? 'es' : ''} — showing matched batchmates only
        </span>
      </div>
      <button
        onClick={onClear}
        className="bg-transparent border border-amber-400/40 rounded-lg text-amber-700 cursor-pointer text-xs font-bold px-2.5 py-1 hover:bg-amber-400/20 transition-colors"
      >
        <i className="fas fa-times mr-1" /> Clear
      </button>
    </div>
  );
}

// Department card (shown at level 0)
function DepartmentCard({ name, totalStudents, courses, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1d2b4b] text-[#fdb813] text-xl group-hover:bg-[#fdb813] group-hover:text-[#1d2b4b] transition-colors">
            <i className="fas fa-building-columns" />
          </div>
          <div>
            <h2 className="m-0 text-xl font-extrabold text-[#1d2b4b]">{name}</h2>
            <p className="m-0 text-xs font-bold text-slate-400 mt-0.5">
              {Object.keys(courses).length} course{Object.keys(courses).length !== 1 ? 's' : ''} · {totalStudents} student{totalStudents !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-300 group-hover:text-[#fdb813] transition-colors">
          <span className="text-xs font-bold text-slate-400 group-hover:text-[#3f51b5]">View Courses</span>
          <i className="fas fa-chevron-right text-sm" />
        </div>
      </div>

      {/* Course preview pills */}
      <div className="flex flex-wrap gap-2 mt-4">
        {Object.keys(courses).slice(0, 4).map(course => (
          <span key={course} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-100">
            {course}
          </span>
        ))}
        {Object.keys(courses).length > 4 && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-[#3f51b5]">
            +{Object.keys(courses).length - 4} more
          </span>
        )}
      </div>
    </button>
  );
}

// Course card (shown at level 1)
function CourseCard({ name, sections, onClick }) {
  const totalStudents = Object.values(sections).flat().length;
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-slate-100 bg-slate-50 p-5 hover:bg-white hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-slate-200 text-[#fdb813] group-hover:bg-[#3f51b5] group-hover:border-[#3f51b5] group-hover:text-white transition-colors">
            <i className="fas fa-graduation-cap text-sm" />
          </div>
          <div>
            <h3 className="m-0 text-base font-extrabold text-[#3f51b5]">{name}</h3>
            <p className="m-0 text-xs font-bold text-slate-400 mt-0.5">
              {Object.keys(sections).length} section{Object.keys(sections).length !== 1 ? 's' : ''} · {totalStudents} student{totalStudents !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-400 group-hover:text-[#3f51b5]">View Sections</span>
          <i className="fas fa-chevron-right text-sm text-slate-300 group-hover:text-[#3f51b5] transition-colors" />
        </div>
      </div>

      {/* Section preview */}
      <div className="flex flex-wrap gap-2 mt-3">
        {Object.keys(sections).slice(0, 6).map(section => (
          <span key={section} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white text-slate-500 border border-slate-200">
            {section}
          </span>
        ))}
        {Object.keys(sections).length > 6 && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-[#3f51b5]">
            +{Object.keys(sections).length - 6} more
          </span>
        )}
      </div>
    </button>
  );
}

// Section card (shown at level 2)
function SectionCard({ name, students, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-slate-100 bg-white p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group ring-1 ring-slate-100"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-[#3f51b5] group-hover:bg-[#3f51b5] group-hover:text-white transition-colors">
            <i className="fas fa-layer-group text-sm" />
          </div>
          <div>
            <h4 className="m-0 text-sm font-black text-[#1d2b4b]">Section {name}</h4>
            <span className="text-[11px] font-black text-[#3f51b5]">
              {students.length} student{students.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-400 group-hover:text-[#3f51b5]">View Students</span>
          <i className="fas fa-chevron-right text-sm text-slate-300 group-hover:text-[#3f51b5] transition-colors" />
        </div>
      </div>

      {/* Avatar preview */}
      <div className="flex items-center gap-1 flex-wrap">
        {students.slice(0, 8).map(student => (
          <div key={student.id} className="h-9 w-9 rounded-xl overflow-hidden bg-[#1d2b4b] border-2 border-white shrink-0">
            {student.profile_picture ? (
              <img src={imageUrl(student.profile_picture)} alt={student.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-[#fdb813]">
                {getInitials(student.name)}
              </div>
            )}
          </div>
        ))}
        {students.length > 8 && (
          <div className="h-9 px-2 rounded-xl bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-500">
            +{students.length - 8}
          </div>
        )}
      </div>
    </button>
  );
}

// Student card
function StudentCard({ student, activeYear, isMatched, matchData }) {
  const profileId = studentRecordId(student);

  return (
    <Link
      to={`/discover/students/${profileId}`}
      className={`relative flex items-center gap-3 rounded-2xl border bg-white p-3 no-underline transition hover:-translate-y-0.5 hover:shadow-md
        ${isMatched ? 'border-[#fdb813]' : 'border-slate-200'}`}
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[#1d2b4b]">
        {student.profile_picture ? (
          <img src={imageUrl(student.profile_picture)} alt={student.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-black text-[#fdb813]">
            {getInitials(student.name)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h5 className="m-0 truncate text-sm font-extrabold text-[#1d2b4b]">{student.name}</h5>
        <p className="m-0 mt-1 truncate text-xs font-bold text-slate-400">
          Batch {student.graduation_year ?? activeYear}
        </p>
        {student.student_id && (
          <p className="m-0 mt-1 text-[11px] text-slate-400">{student.student_id}</p>
        )}
      </div>
      {isMatched && (
        <span className="absolute right-2 top-2 rounded-full bg-[#fdb813] px-2 py-0.5 text-[10px] font-black text-[#1d2b4b]">
          {matchData?.similarity != null
            ? `${Number(matchData.similarity).toFixed(0)}%`
            : 'Match'}
        </span>
      )}
    </Link>
  );
}

// Main Page
export default function BatchmatesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const cleanParam = (value) => {
    if (!value) return null;
    const normalized = String(value).trim();
    return ['null', 'undefined', ''].includes(normalized.toLowerCase()) ? null : normalized;
  };

  const { user, batchmates, loading, isPremium, filterMeta, fetchBatchmates } = useBatch();

  const [search,           setSearch]           = useState('');
  const [courseFilter,     setCourseFilter]     = useState(cleanParam(searchParams.get('course')));
  const [departmentFilter, setDepartmentFilter] = useState(cleanParam(searchParams.get('department')));
  const [sectionFilter,    setSectionFilter]    = useState(cleanParam(searchParams.get('section')));
  const [yearFilter,       setYearFilter]       = useState(
    searchParams.get('year') ? Number(searchParams.get('year')) : null
  );
  const [faceSearching, setFaceSearching] = useState(false);
  const [faceMatches,   setFaceMatches]   = useState([]);
  const [matchedIds,    setMatchedIds]    = useState(new Set());

  // Drill level: 0=departments, 1=courses, 2=sections, 3=students
  const drillLevel = sectionFilter ? 3 : courseFilter ? 2 : departmentFilter ? 1 : 0;

  const activeYear        = yearFilter ?? filterMeta.year ?? user?.graduation_year ?? null;
  const activeCourse      = courseFilter ?? filterMeta.course ?? null;
  const activeCourseLabel = activeCourse
    ? activeCourse.split(' ').slice(-2).join(' ')
    : 'All Programs';

  useEffect(() => {
    const params = {};
    if (departmentFilter) params.department = departmentFilter;
    if (courseFilter)     params.course     = courseFilter;
    if (yearFilter)       params.year       = yearFilter;
    fetchBatchmates(params);
    const next = {};
    if (departmentFilter) next.department = departmentFilter;
    if (courseFilter)     next.course     = courseFilter;
    if (sectionFilter)    next.section    = sectionFilter;
    if (yearFilter)       next.year       = yearFilter;
    setSearchParams(next, { replace: true });
  }, [departmentFilter, courseFilter, sectionFilter, yearFilter]);

  useEffect(() => {
    if (!activeYear) return;
    recordContentView({
      content_type: 'batch',
      content_id: Number(activeYear),
      title: `Batch ${activeYear}`,
      category: activeCourse || 'All Programs',
      url: `/batchmates?year=${activeYear}`,
    }).catch(() => {});
  }, [activeYear, activeCourse]);

  const handleFaceFile = async (file) => {
    setFaceSearching(true);
    setFaceMatches([]);
    setMatchedIds(new Set());
    setSearch('');
    try {
      const formData = new FormData();
      formData.append('face_image', file);
      const { data } = await faceApi.search(formData);
      const matches = usableFaceMatches(data.matches ?? []);
      if (!matches.length) {
        alert('No matching batchmate found. Ensure the photo shows a clear face.');
        return;
      }
      setFaceMatches(matches);
      setMatchedIds(new Set(matches.map(m => m.user_id)));
    } catch (err) {
      alert(err?.response?.data?.message || 'Face search failed. Please try again.');
    } finally {
      setFaceSearching(false);
    }
  };

  const clearFace = () => {
    setFaceMatches([]);
    setMatchedIds(new Set());
  };

  const resetDrill = () => {
    setDepartmentFilter(null);
    setCourseFilter(null);
    setSectionFilter(null);
    clearFace();
  };

  const searchQuery = normalizeText(search);

  // Base filtered list (search + face + dept + course applied here)
  const baseFiltered = batchmates.filter(s => {
    const studentSection    = s.section?.name || s.section_name;
    const studentDepartment = s.batch?.department || s.department;
    const studentBatch      = s.batch?.name || s.batch_year || s.graduation_year || filterMeta.year;
    const textMatch = !searchQuery || [
      s.name, s.student_id, s.student_no, s.course,
      studentSection, studentDepartment, studentBatch,
    ].some(value => includesSearch(value, searchQuery));
    const selectedCourse          = courseFilter || null;
    const selectedCourseMatch     = !selectedCourse || courseMatches(s.course, selectedCourse);
    const selectedDepartmentMatch = !departmentFilter || normalizeText(studentDepartment) === normalizeText(departmentFilter);
    if (matchedIds.size > 0) {
      return matchedIds.has(studentUserId(s)) && textMatch && selectedCourseMatch && selectedDepartmentMatch;
    }
    return textMatch && selectedCourseMatch && selectedDepartmentMatch;
  });

  // Final filtered with section applied
  const filtered = baseFiltered.filter(s => {
    if (!sectionFilter) return true;
    const studentSection = s.section?.name || s.section_name || 'No Section';
    return normalizeText(studentSection) === normalizeText(sectionFilter);
  });

  // Full grouped structure
  const groupedBatchmates = filtered.reduce((groups, student) => {
    const department = student.batch?.department || student.department || 'Department';
    const course     = student.course || 'Course';
    const section    = student.section?.name || student.section_name || 'No Section';
    groups[department] ??= {};
    groups[department][course] ??= {};
    groups[department][course][section] ??= [];
    groups[department][course][section].push(student);
    return groups;
  }, {});

  // Also need the raw group (without section filter) for section picker
  const groupedNoSection = baseFiltered.reduce((groups, student) => {
    const department = student.batch?.department || student.department || 'Department';
    const course     = student.course || 'Course';
    const section    = student.section?.name || student.section_name || 'No Section';
    groups[department] ??= {};
    groups[department][course] ??= {};
    groups[department][course][section] ??= [];
    groups[department][course][section].push(student);
    return groups;
  }, {});

  const departmentOptions    = Object.keys(groupedBatchmates);
  const coursesForActiveDept = departmentFilter ? Object.keys(groupedNoSection[departmentFilter] ?? {}) : [];
  const sectionsForActiveCourse = (departmentFilter && courseFilter)
    ? Object.keys(groupedNoSection[departmentFilter]?.[courseFilter] ?? {})
    : [];

  // What to render in main content based on drill level
  const renderContent = () => {
    if (loading) {
      return <LoadingSkeleton variant="card" count={6} />;
    }

    if (filtered.length === 0 && drillLevel === 3) {
      return (
        <div className="text-center bg-white py-24 px-8 rounded-[30px] shadow-sm">
          <i className="fas fa-users-slash text-6xl mb-5 block opacity-10 text-[#1d2b4b]" />
          <h3 className="font-extrabold text-xl mb-2 text-[#1d2b4b]">No Students Found</h3>
          <p className="text-sm text-slate-400">Try clearing your filters or searching a different name.</p>
        </div>
      );
    }

    if (batchmates.length === 0 && !loading) {
      return (
        <div className="text-center bg-white py-24 px-8 rounded-[30px] shadow-sm">
          <i className="fas fa-users-slash text-6xl mb-5 block opacity-10 text-[#1d2b4b]" />
          <h3 className="font-extrabold text-xl mb-2 text-[#1d2b4b]">No Batchmates Found</h3>
          <p className="text-sm text-slate-400">
            {matchedIds.size > 0
              ? 'Try a different photo or clear the face filter.'
              : 'Make sure your graduation year and course are set in Profile Settings.'}
          </p>
          {matchedIds.size > 0 && (
            <button onClick={clearFace} className="mt-4 font-bold text-sm px-5 py-2.5 rounded-xl border-none cursor-pointer bg-[#1d2b4b] text-white">
              Clear Face Filter
            </button>
          )}
        </div>
      );
    }

    // Level 0 show department cards
    if (drillLevel === 0) {
      return (
        <div className="space-y-4">
          {Object.entries(groupedBatchmates).map(([dept, courses]) => {
            const total = Object.values(courses).flatMap(s => Object.values(s).flat()).length;
            return (
              <DepartmentCard
                key={dept}
                name={dept}
                totalStudents={total}
                courses={courses}
                onClick={() => setDepartmentFilter(dept)}
              />
            );
          })}
        </div>
      );
    }

    // Level 1 show course cards for active department
    if (drillLevel === 1) {
      const deptData = groupedBatchmates[departmentFilter] ?? {};
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1d2b4b] text-[#fdb813]">
              <i className="fas fa-building-columns" />
            </div>
            <div>
              <h2 className="m-0 text-xl font-extrabold text-[#1d2b4b]">{departmentFilter}</h2>
              <p className="m-0 text-xs font-bold text-slate-400">Select a course to continue</p>
            </div>
          </div>
          <div className="space-y-3">
            {Object.entries(deptData).map(([course, sections]) => (
              <CourseCard
                key={course}
                name={course}
                sections={sections}
                onClick={() => setCourseFilter(course)}
              />
            ))}
          </div>
        </div>
      );
    }

    // Level 2 show section cards for active course
    if (drillLevel === 2) {
      const sectionData = groupedBatchmates[departmentFilter]?.[courseFilter] ?? {};
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-slate-200 text-[#fdb813]">
              <i className="fas fa-graduation-cap" />
            </div>
            <div>
              <h2 className="m-0 text-xl font-extrabold text-[#3f51b5]">{courseFilter}</h2>
              <p className="m-0 text-xs font-bold text-slate-400">Select a section to see students</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(sectionData).map(([section, students]) => (
              <SectionCard
                key={section}
                name={section}
                students={students}
                onClick={() => setSectionFilter(section)}
              />
            ))}
          </div>
        </div>
      );
    }

    // Level 3 show student grid for active section
    const students = groupedBatchmates[departmentFilter]?.[courseFilter]?.[sectionFilter] ?? [];
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-[#3f51b5]">
              <i className="fas fa-layer-group" />
            </div>
            <div>
              <h2 className="m-0 text-xl font-extrabold text-[#1d2b4b]">Section {sectionFilter}</h2>
              <p className="m-0 text-xs font-bold text-slate-400">{courseFilter}</p>
            </div>
          </div>
          <span className="rounded-full bg-indigo-50 px-4 py-1.5 text-xs font-black text-[#3f51b5]">
            {students.length} student{students.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {students.map(student => {
            const userId    = studentUserId(student);
            const matchData = faceMatches.find(m => m.user_id === userId);
            const isMatched = matchedIds.has(userId);
            return (
              <StudentCard
                key={student.id}
                student={student}
                activeYear={activeYear}
                isMatched={isMatched}
                matchData={matchData}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] font-['Plus_Jakarta_Sans',sans-serif]">
      <Navbar />

      {/* Hero */}
      <header className="text-white text-center bg-gradient-to-br from-[#1d2b4b] to-[#2a3d66] px-[8%] pt-12 pb-14 rounded-b-[48px]">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2 text-[#fdb813]">
          National University Lipa
        </p>
        <h1 className="font-extrabold mb-2 text-[2rem] tracking-tight">
          Your <span className="text-[#fdb813]">Batchmates</span>
        </h1>
        <p className="font-light mx-auto text-white/70 mb-5 text-[0.88rem] max-w-[480px]">
          Connect with fellow Pioneers · {activeCourseLabel}
          &nbsp;· Batch {filterMeta.year ?? yearFilter ?? user?.graduation_year ?? CURRENT_YEAR}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {isPremium && (
            <span className="inline-flex items-center gap-2 font-bold text-xs bg-[rgba(253,184,19,0.15)] border border-[rgba(253,184,19,0.4)] px-5 py-2 rounded-full text-[#fdb813]">
              <i className="fas fa-crown" /> Premium · Viewing All Profiles
            </span>
          )}
          <GenerateYearbookButton year={activeYear} department={departmentFilter} course={activeCourse} />
        </div>
      </header>

      {/* Sticky Filters */}
      <div className="bg-white px-[8%] py-[18px] shadow-sm border-b border-slate-200 sticky top-0 z-20 flex flex-wrap gap-3 items-center justify-between">
        {/* Search + face */}
        <div className="relative min-w-[240px] flex-1 max-w-[320px]">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
          <input
            type="text"
            placeholder="Search name or student ID…"
            value={search}
            onChange={e => { setSearch(e.target.value); clearFace(); }}
            className={`w-full text-sm font-medium rounded-xl outline-none pl-8 pr-12 py-[10px] bg-[#f8fafc] text-[#1d2b4b] border-[1.5px]
              ${matchedIds.size > 0 ? 'border-[#fdb813]' : 'border-slate-200'}`}
          />
          <FaceSearchButton onFile={handleFaceFile} loading={faceSearching} />
        </div>

        {/* Drill-down chips row 1: departments */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2 items-center">
            <Chip
              label="All Departments"
              active={!departmentFilter}
              count={departmentOptions.length || undefined}
              onClick={resetDrill}
            />
            {departmentOptions.map(dept => (
              <Chip
                key={dept}
                label={dept}
                active={departmentFilter === dept}
                onClick={() => { setDepartmentFilter(dept); setCourseFilter(null); setSectionFilter(null); clearFace(); }}
              />
            ))}
          </div>

          {/* Row 2: courses (only if dept selected) */}
          {departmentFilter && coursesForActiveDept.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <Chip
                label="All Courses"
                active={!courseFilter}
                onClick={() => { setCourseFilter(null); setSectionFilter(null); clearFace(); }}
              />
              {coursesForActiveDept.map(course => (
                <Chip
                  key={course}
                  label={course}
                  active={courseFilter === course}
                  onClick={() => { setCourseFilter(course); setSectionFilter(null); clearFace(); }}
                />
              ))}
            </div>
          )}

          {/* Row 3: sections (only if course selected) */}
          {courseFilter && sectionsForActiveCourse.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <Chip
                label="All Sections"
                active={!sectionFilter}
                onClick={() => { setSectionFilter(null); clearFace(); }}
              />
              {sectionsForActiveCourse.map(section => (
                <Chip
                  key={section}
                  label={section}
                  active={sectionFilter === section}
                  onClick={() => { setSectionFilter(section); clearFace(); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Year + Yearbook */}
        <div className="flex items-center gap-2">
          <select
            value={yearFilter ?? ''}
            onChange={e => setYearFilter(e.target.value ? Number(e.target.value) : null)}
            className="font-bold text-xs px-4 py-2 rounded-xl border-none outline-none bg-[#f1f5f9] text-slate-500 cursor-pointer"
          >
            <option value="">All Years</option>
            {YEAR_OPTIONS.map(y => (
              <option key={y} value={y}>Batch {y}</option>
            ))}
          </select>
          <YearbookFilterPill year={yearFilter} department={departmentFilter} course={activeCourse} />
        </div>
      </div>

      {/* Count Pill */}
      {!loading && (
        <div className="flex justify-center mt-6 relative z-10">
          <div className="font-bold text-sm flex items-center gap-2 bg-white px-7 py-3 rounded-full shadow-[0_10px_25px_rgba(0,0,0,0.08)] text-slate-600">
            <i className="fas fa-graduation-cap text-[#fdb813]" />
            {filtered.length} batchmate{filtered.length !== 1 ? 's' : ''} found
            {!isPremium && (
              <span className="text-slate-400 text-[0.75rem]">&nbsp;· Public profiles only</span>
            )}
          </div>
        </div>
      )}

      {/* Face Banner */}
      {faceMatches.length > 0 && (
        <div className="mt-3">
          <FaceResultBanner matches={faceMatches} onClear={clearFace} />
        </div>
      )}

      {/* Upgrade Banner */}
      {!isPremium && !loading && batchmates.length > 0 && (
        <div className="mx-[8%] mt-6 flex items-center justify-between gap-4 rounded-2xl px-6 py-4 bg-gradient-to-br from-[#1d2b4b] to-[#3f51b5] text-white">
          <div className="flex items-center gap-3">
            <i className="fas fa-lock text-xl text-[#fdb813]" />
            <div>
              <p className="font-extrabold text-sm m-0">Unlock Full Batchmate Profiles</p>
              <p className="text-xs opacity-70 m-0">
                Premium sees all batchmates, full bios, section info, mottos & contact details.
              </p>
            </div>
          </div>
          <Link to="/premium" className="no-underline font-bold text-xs px-5 py-3 rounded-xl whitespace-nowrap bg-[#fdb813] text-[#1d2b4b]">
            Upgrade Now <i className="fas fa-arrow-right ml-1" />
          </Link>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 px-[8%] pt-8 pb-20">
        {/* Breadcrumb */}
        <Breadcrumb
          department={departmentFilter}
          course={courseFilter}
          section={sectionFilter}
          onClickDept={resetDrill}
          onClickCourse={() => { setCourseFilter(null); setSectionFilter(null); }}
        />

        {renderContent()}
      </main>

      <Footer />
    </div>
  );
}
