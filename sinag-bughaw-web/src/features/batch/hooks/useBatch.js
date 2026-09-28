import { useState, useEffect, useCallback } from 'react';
import { batchApi, sectionsApi } from '@/api/batch.api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { hasPaidAccess } from '@/utils/subscription';

// useBatch

export function useBatch() {
  const { user } = useAuth();

  // Standard + Premium both unlock paid discovery/batchmate features.
  const isPremium = hasPaidAccess(user);

  const [batchmates,   setBatchmates]   = useState([]);
  const [batches,      setBatches]      = useState({});
  const [departments,  setDepartments]  = useState([]);
  const [deptStudents, setDeptStudents] = useState({});
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [filterMeta,   setFilterMeta]   = useState({ course: null, year: null });

  /** Fetch current user's batchmates with optional course/year override. */
  const fetchBatchmates = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await batchApi.batchmates(params);
      setBatchmates(data.data ?? []);
      setFilterMeta(data.filter ?? {});
      return data;
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to load batchmates.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch all batches grouped by department. */
  const fetchAllBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await batchApi.all();
      setBatches(data.data ?? {});
      setDepartments(data.departments ?? []);
      return data;
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to load batches.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch students from a specific department/college. */
  const fetchByDepartment = useCallback(async (department) => {
    setLoading(true);
    try {
      const { data } = await batchApi.byDepartment(department);
      setDeptStudents(data.data ?? {});
      return data;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    user,
    isPremium,        // paid access from shared subscription helpers
    batchmates,
    batches,
    departments,
    deptStudents,
    loading,
    error,
    filterMeta,
    fetchBatchmates,
    fetchAllBatches,
    fetchByDepartment,
  };
}

// useSection

export function useSection(sectionId = null) {
  const { user } = useAuth();

  const isPremium = hasPaidAccess(user);

  const [sections,  setSections]  = useState([]);
  const [section,   setSection]   = useState(null);
  const [students,  setStudents]  = useState([]);
  const [meta,      setMeta]      = useState(null);
  const [counts,    setCounts]    = useState({ total: 0, visible: 0 });
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    if (sectionId) {
      sectionsApi.show(sectionId)
        .then(({ data }) => {
          setSection(data.section);
          setStudents(data.students?.data ?? []);
          setMeta(data.students);
          setCounts({ total: data.total ?? 0, visible: data.visible ?? 0 });
        })
        .catch(() => setError('Section not found.'))
        .finally(() => setLoading(false));
    } else {
      sectionsApi.list()
        .then(({ data }) => setSections(data))
        .catch(() => setError('Failed to load sections.'))
        .finally(() => setLoading(false));
    }
  }, [sectionId]);

  return {
    sections,
    section,
    students,
    meta,
    counts,
    loading,
    error,
    isPremium,
  };
}
