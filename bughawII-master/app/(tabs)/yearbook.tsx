import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { FontAwesome } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  addYearbookBookmark,
  fetchCurrentUser,
  generateYearbook,
  getAppConfig,
  getErrorMessage,
  getMobileYearbookPdfUrl,
  getYearbookBatches,
  getYearbookBookmarks,
  getYearbookGalleries,
  getYearbookMeta,
  getYearbookPages,
  imageUrl,
  recordContentView,
  removeYearbookBookmark,
  searchYearbook,
  unwrap,
} from '../../lib/api';
import UpgradePrompt, { hasPaidAccess } from '../../components/UpgradePrompt';


const NAVY   = '#0D1B3E';
const GOLD   = '#E5A820';
const GOLDDIM= '#C9A84C';
const CREAM  = '#F5F0E8';
const CREAMD = '#EDE5D4';
const PAPER  = '#FFFDF8';
const WHITE  = '#FFFFFF';
const MUTED  = '#7A8299';
const BG     = '#F0F4FC';

const { width: SW, height: SH } = Dimensions.get('window');
const PAGE_H = Math.max(440, Math.min(580, SH - 290));
const PAGE_W = SW - 28;
const TOC_PER_PAGE = 7;
const FLIP_PREP_MS = 0;

const FLIP_DURATION_MS = 1050;
const FLIP_OPEN_DEG = 90;

// Flip state single atomic object
type FlipPhase = 'idle' | 'animating';
type FlipState = {
  phase: FlipPhase;
  currentIndex: number;
  currentPage: any;
  targetIndex: number;
  targetPage: any;
  dir: 1 | -1;
};

const makeFlipState = (index: number, page: any): FlipState => ({
  phase: 'idle',
  currentIndex: index,
  currentPage: page,
  targetIndex: index,
  targetPage: null,
  dir: 1,
});

// Utility helpers 
const bid   = (x: any) => x?.id || x?.batch_id;
const byear = (x: any) => x?.year || x?.graduation_year || x?.batch_year || x?.school_year || x?.name || '';
const btitle= (x: any) => x?.title || x?.name || `Batch ${byear(x)}`.trim();
const sname = (s: any) => s?.name || s?.full_name || `${s?.first_name||''} ${s?.last_name||''}`.trim() || 'Student';

const flatten = (p: any) => {
  const d = unwrap(p);
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.data)) return d.data;
  if (!d || typeof d !== 'object') return [];
  return Object.values(d).flatMap((g: any) => Array.isArray(g) ? g : []);
};

const isPaid = (u: any) => hasPaidAccess(u);

const ptype  = (p: any) => String(p?.type || p?.page_type || '').toLowerCase();
const ptitle = (p: any, fb = 'Yearbook Page') => p?.title || p?.label || p?.name || fb;
const pcopy  = (p: any, fb = '') => p?.excerpt || p?.subtitle || p?.description || p?.content || fb;
const ft     = (...vs: any[]) => vs.find(v => typeof v === 'string' && v.trim())?.trim() || '';
const psrc   = (v: any) => imageUrl(v) || null;
const sphoto = (s: any) => psrc(s?.photo || s?.profile_picture || s?.profile_pic || s?.avatar);
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0,2).map(p => p[0]?.toUpperCase()).join('') || 'SB';
const scourse  = (s: any, sec?: any) => { const v = ft(s?.course, sec?.strand, sec?.course, sec?.name); return v.toLowerCase() === 'no program listed' ? '' : v; };

const nameLines = (name: string, maxLen = 14, maxL = 3) => {
  const words = String(name || 'Graduate').toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  words.forEach(w => {
    const cur = lines[lines.length - 1] || '';
    if (!cur) lines.push(w);
    else if (`${cur} ${w}`.length <= maxLen) lines[lines.length - 1] = `${cur} ${w}`;
    else if (lines.length < maxL) lines.push(w);
    else lines[lines.length - 1] = `${lines[lines.length - 1]} ${w}`;
  });
  return lines.slice(0, maxL).map((l, i) =>
    i === maxL - 1 && l.length > maxLen + 2 ? `${l.slice(0, maxLen)}...` : l,
  );
};

const statPairs = (s: any): [string, any][] => ([
  ['Graduates',   s?.totalGraduates],
  ['Sections',    s?.sectionCount],
  ['Honors',      s?.honorsCount],
  ['Achievements',s?.achievementCount],
] as [string, any][]).filter(([, v]) => v !== undefined && v !== null && v !== '');

const distPairs = (v: any): [string, any][] => {
  if (!v || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.map((i: any) => [i?.label || i?.name || i?.course || 'Entry', i?.value || i?.count || 0]);
  return Object.entries(v);
};

const msgDetails = (p: any) => {
  const meta = p?.meta || {};
  const year = meta?.year || new Date().getFullYear();
  const school = meta?.school || 'National University - Lipa';
  const type = String(p?.messageType || p?.message_type || '').toLowerCase();
  const map: Record<string, any> = {
    university: { eyebrow: 'University Message', title: 'A Tradition of Purpose',    body: `To the Class of ${year}, this yearbook gathers more than portraits. It preserves the discipline, friendship, service, and courage that shaped your years at ${school}.`, author: school },
    dean:       { eyebrow: 'Dean Message',       title: 'Scholarship With Character', body: 'Your achievements are not measured by honors alone, but by the integrity with which you carried your work and the generosity you offered one another.',                  author: 'Office of the Dean' },
    chair:      { eyebrow: 'Dept. Chair Message',title: 'The Work Continues',         body: 'May the habits you formed here become the foundation for service, leadership, and excellent work wherever the next chapter calls you.',                                    author: 'Department Chair' },
  };
  return map[type] || map.university;
};

const galPhotos = (g: any) => {
  const items = g?.photos || g?.media || g?.items || [];
  return Array.isArray(items)
    ? items.map((i: any) => ({ url: psrc(i?.url || i?.cloudinary_url || i?.file_path || i?.thumbnail || i?.src), caption: i?.caption || i?.title || '' })).filter((i: any) => i.url).slice(0, 6)
    : [];
};

const isApproved = (i: any) => {
  const s = String(i?.status || i?.moderation_status || i?.approval_status || '').toLowerCase();
  if (['pending','rejected','unapproved','hidden'].includes(s)) return false;
  if (i?.is_approved === false || i?.approved === false || i?.is_public === false) return false;
  return true;
};
const galCover = (g: any) => {
  const media = [...(g?.photos||[]),...(g?.media||[]),...(g?.media_files||[])];
  const ok = media.find(i => isApproved(i) && imageUrl(i?.file_path || i?.url || i?.thumbnail_url || i?.thumbnail));
  return ok ? imageUrl(ok?.file_path || ok?.url || ok?.thumbnail_url || ok?.thumbnail) : null;
};
const galTitle = (g: any) => g?.title || g?.name || g?.album_title || 'Yearbook Gallery';
const galCount = (g: any) => g?.photos_count ?? g?.media_count ?? g?.items_count ?? g?.photos?.length ?? g?.media?.length ?? 0;

const plabel = (p: any, i: number) => p?.label || p?.title || p?.type || `Page ${i + 1}`;
const pnum   = (p: any, i: number) => p?.pageIndex ?? p?.index ?? i + 1;
const readerPageLabel = (p: any, i: number) => {
  const type = ptype(p);
  if (type === 'cover' || type === 'back-cover') return 'Yearbook Cover';
  if (type === 'dedication') return 'Dedication';
  if (type === 'toc') return 'Table of Contents';
  return plabel(p, i);
};

// Page builder
const buildPages = (batch: any, galleries: any[] = []) => {
  const sections = Array.isArray(batch?.sections) ? batch.sections : [];
  const year = byear(batch) || new Date().getFullYear();
  const meta = { title: `Digital Yearbook - ${year}`, year, school: 'National University Lipa' };
  const pages: any[] = [
    { type:'cover',            label:'Cover',               title:`Class of ${year}`,           meta },
    { type:'dedication',       label:'Dedication',          title:'Legacy in Motion',            meta },
    { type:'toc',              label:'Contents',            title:'Table of Contents',           meta },
    { type:'welcome',          label:'University Message',  title:'A Tradition of Purpose',      messageType:'university', meta },
    { type:'welcome',          label:'Dean Message',        title:'Scholarship With Character',  messageType:'dean',       meta },
    { type:'welcome',          label:'Dept. Chair Message', title:'The Work Continues',          messageType:'chair',      meta },
    { type:'program-overview', label:'Program Overview',    title:'Academic Profile',            stats:{}, meta },
    { type:'stats',            label:'Class Statistics',    title:`${year} at a Glance`,         stats:{}, meta },
  ];
  const courses = new Map<string, any[]>();
  sections.forEach((s: any) => {
    const c = ft(s?.course, s?.strand, batch?.course, 'Course');
    if (!courses.has(c)) courses.set(c, []);
    courses.get(c)!.push(s);
  });
  courses.forEach((secs, c) => {
    const count = secs.reduce((n: number, s: any) => n + (Array.isArray(s?.students) ? s.students.length : 0), 0);
    pages.push({ type:'course-header', label:c, title:c, course:c, sections:secs, studentCount:count, meta });
    secs.forEach((sec: any) => {
      const students = Array.isArray(sec?.students) ? sec.students : [];
      pages.push({ type:'section-header', label:sec?.name||'Section', title:`Section ${sec?.name||''}`.trim(), section:sec, course:c, meta });
      students.forEach((st: any) => {
        pages.push({ type:'student-profile', label:sname(st),              profilePart:'portrait', student:st, section:sec, meta });
        pages.push({ type:'student-profile', label:`${sname(st)} Story`,   profilePart:'details',  student:st, section:sec, meta });
      });
    });
  });
  pages.push({ type:'closing', label:'Closing', title:'End of Yearbook', meta });
  return pages.map((p, i) => ({ ...p, id: p.id || `m-${i}`, pageIndex: i+1, index: i+1 }));
};

// Shared page-shell components
type Tone = 'dark' | 'cream' | 'paper';

function Shell({ children, tone = 'paper' }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <View style={[pg.shell, tone === 'dark' && pg.shellDark, tone === 'cream' && pg.shellCream]}>
      <View pointerEvents="none" style={[pg.fo, tone === 'dark' && pg.foDark]} />
      <View pointerEvents="none" style={[pg.fi, tone === 'dark' && pg.fiDark]} />
      {children}
    </View>
  );
}

function Rule({ dark = false }: { dark?: boolean }) {
  return <View style={[pg.rule, dark && pg.ruleDark]} />;
}

function Head({ eyebrow, title, body, dark = false }: { eyebrow?: string; title: string; body?: string; dark?: boolean }) {
  return (
    <View style={pg.head}>
      {eyebrow ? <Text style={[pg.kick, dark && pg.kickDark]}>{eyebrow}</Text> : null}
      <Text style={[pg.disp, dark && pg.dispDark]}>{title}</Text>
      <Rule dark={dark} />
      {body ? <Text style={[pg.body, dark && pg.bodyDark]}>{body}</Text> : null}
    </View>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <View style={pg.infoBox}>
      <Text style={pg.infoL}>{label}</Text>
      <Text style={pg.infoV} numberOfLines={2}>{value || 'Not set'}</Text>
    </View>
  );
}

// Page renderers
function CoverPage({ page, yn }: { page: any; yn: string }) {
  const meta = page?.meta || {};
  const year = meta?.year || page?.year || '';
  const stats = statPairs(page?.stats);
  return (
    <Shell tone="dark">
      <View style={pg.cc}>
        <Text style={pg.csc}>{meta?.school || 'National University Lipa'}</Text>
        <Text style={pg.ctitle}>{meta?.title || ptitle(page, yn)}</Text>
        <Rule dark />
        {meta?.theme ? <Text style={pg.ctheme}>{meta.theme}</Text> : null}
        {year ? <View style={pg.cyw}><Text style={pg.cco}>Class of</Text><Text style={pg.cy}>{year}</Text></View> : null}
        <View style={pg.cedb}><Text style={pg.cedt}>SENIOR YEARBOOK</Text></View>
        {stats.length ? (
          <View style={pg.cstats}>
            {stats.map(([l, v]) => (
              <View key={l} style={pg.cstat}><Text style={pg.csv}>{v}</Text><Text style={pg.csl}>{l}</Text></View>
            ))}
          </View>
        ) : null}
        <Text style={pg.cac}>{year ? `Academic Year ${year}` : yn}</Text>
      </View>
    </Shell>
  );
}

function TocPage({ page, index }: { page: any; index: number }) {
  const toc = Array.isArray(page?.toc) ? page.toc : [];
  const start = Number.isFinite(Number(page?.tocStart)) ? Number(page.tocStart) : Math.max(0, index - 2) * TOC_PER_PAGE;
  const entries = toc.slice(start, start + TOC_PER_PAGE);
  return (
    <Shell tone="cream">
      <Head eyebrow="TABLE OF" title="Contents" />
      <View style={pg.tocList}>
        {entries.length ? entries.map((e: any, i: number) => (
          <View key={`${e?.label||'e'}-${i}`} style={pg.tocRow}>
            <Text style={pg.tocN}>{String(start + i + 1).padStart(2, '0')}</Text>
            <View style={pg.tocT}>
              <Text style={pg.tocL} numberOfLines={2}>{e?.label || 'Yearbook Section'}</Text>
              <Text style={pg.tocP}>PAGE {(e?.pageIndex ?? e?.page_index ?? 0) + 1}</Text>
            </View>
          </View>
        )) : <Text style={pg.body}>Contents appear after yearbook pages are generated.</Text>}
      </View>
    </Shell>
  );
}

function MsgPage({ page }: { page: any }) {
  const msg = msgDetails(page);
  const year = page?.meta?.year || new Date().getFullYear();
  return (
    <Shell tone="paper">
      <Text style={pg.kick}>{msg.eyebrow}</Text>
      <Text style={pg.disp}>{msg.title}</Text>
      <Rule />
      <Text style={[pg.body, { marginBottom: 18 }]}>{msg.body}</Text>
      <View style={pg.msgSig}>
        <Text style={pg.msgA}>{msg.author}</Text>
        <Text style={pg.kick}>Class of {year}</Text>
      </View>
    </Shell>
  );
}

function ProgPage({ page }: { page: any }) {
  const stats = statPairs(page?.stats);
  const meta  = page?.meta || {};
  return (
    <Shell tone="paper">
      <Head eyebrow="Program Overview" title="Academic Profile" body={`A graduating community shaped by ${meta?.school || 'National University'} tradition and service.`} />
      <View style={pg.sgrid}>
        {stats.map(([l, v]) => <View key={l} style={pg.sbox}><Text style={pg.sv}>{v}</Text><Text style={pg.sl}>{l}</Text></View>)}
      </View>
    </Shell>
  );
}

function StatsPage({ page }: { page: any }) {
  const s = page?.stats || {};
  const courses = distPairs(s.courseDistribution).slice(0,5);
  const honors  = distPairs(s.honorsDistribution).slice(0,5);
  const maxC = Math.max(1, ...courses.map(([,v]) => Number(v)||0));
  const maxH = Math.max(1, ...honors.map(([,v])  => Number(v)||0));
  return (
    <Shell tone="cream">
      <Head eyebrow="Class Statistics" title={`${page?.meta?.year||''} at a Glance`.trim()} />
      <View style={pg.sgrid}>
        {statPairs(s).map(([l,v]) => <View key={l} style={pg.sbox}><Text style={pg.sv}>{v}</Text><Text style={pg.sl}>{l}</Text></View>)}
      </View>
      <Bars title="By Course" items={courses} max={maxC} />
      <Bars title="By Honors"  items={honors}  max={maxH} />
    </Shell>
  );
}

function Bars({ title, items, max }: { title: string; items: any[]; max: number }) {
  if (!items.length) return null;
  return (
    <View style={pg.bBlock}>
      <Text style={pg.bTitle}>{title}</Text>
      {items.map(([l, v]) => (
        <View key={String(l)} style={pg.bRow}>
          <Text style={pg.bL} numberOfLines={1}>{String(l)}</Text>
          <View style={pg.bTrack}><View style={[pg.bFill, { width: `${Math.max(6, (Number(v)||0)/max*100)}%` as any }]} /></View>
          <Text style={pg.bV}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function StudentPage({ page }: { page: any }) {
  const st  = page?.student || page?.students?.[0] || {};
  const sec = page?.section || {};
  const name   = sname(st);
  const photo  = sphoto(st);
  const quote  = ft(st?.student_quote, st?.motto, 'A story still unfolding with promise.');
  const detail = page?.profilePart === 'details';
  const cards: [string, any][] = [
    ['Motto',st?.motto],['Organizations',st?.organizations],['Achievements',st?.achievements],
    ['Ambition',st?.ambition],['Future Plans',st?.future_plans],['Fondest Memory',st?.fondest_memory],
    ['Message to Batchmates',st?.message_to_batchmates],['Message to Parents',st?.message_to_parents],
  ];
  return (
    <Shell tone="paper">
      <View style={pg.stHd}>
        <Text style={pg.kick}>{sec?.name || sec?.course || 'Graduate'}</Text>
        <Text style={pg.disp}>{detail ? 'Graduate Story' : 'Graduate Profile'}</Text>
        <Rule />
      </View>
      {detail ? (
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={pg.stGrid}>
            {cards.map(([l,v]) => (
              <View key={l} style={pg.stCard}>
                <Text style={pg.kick}>{l}</Text>
                <Text style={pg.stTxt}>{v || 'Not set'}</Text>
              </View>
            ))}
          </View>
          <View style={pg.stFoot}>
            <Info label="Student No." value={st?.student_id || st?.student_no} />
            <Info label="Email" value={st?.email} />
            <Info label="Birthday" value={st?.birthday} />
            <Info label="Graduation Year" value={st?.graduation_year} />
          </View>
        </ScrollView>
      ) : (
        <View style={pg.stLay}>
          <View style={pg.stPW}>
            {photo
              ? <Image source={photo} style={pg.stP} contentFit="cover" contentPosition="top" />
              : <View style={pg.stPFb}><Text style={pg.stInit}>{initials(name)}</Text></View>}
          </View>
          <View style={pg.stInfo}>
            {st?.honors ? <View style={pg.honor}><Text style={pg.honorT} numberOfLines={1}>{st.honors}</Text></View> : null}
            <View>{nameLines(name).map((l, i) => <Text key={`${l}-${i}`} style={pg.stN} numberOfLines={1}>{l}</Text>)}</View>
            <Text style={pg.stC} numberOfLines={2}>{scourse(st, sec) || st?.student_id || 'Not set'}</Text>
            <View style={pg.qBlock}><View style={pg.qAcc} /><Text style={pg.qTxt} numberOfLines={3}>{`"${quote}"`}</Text></View>
            <View style={pg.facts}>
              <Info label="Nickname" value={st?.nickname} />
              <Info label="Hometown" value={st?.hometown} />
              <Info label="Most Likely To" value={st?.most_likely_to} />
            </View>
          </View>
        </View>
      )}
    </Shell>
  );
}

function CoursePage({ page }: { page: any }) {
  const c = ft(page?.course?.name, page?.course, ptitle(page,'Course'));
  const secs: string[] = Array.isArray(page?.sections) ? page.sections.map((s: any) => typeof s === 'string' ? s : s?.name).filter(Boolean) : [];
  const cnt = page?.course?.studentCount ?? page?.studentCount ?? 0;
  return (
    <Shell tone="dark">
      <Text style={pg.secWm}>{String(c).slice(0,4).toUpperCase()}</Text>
      <View style={pg.secBody}>
        <Text style={pg.kickDark}>Course</Text>
        <Text style={pg.secTit}>{c}</Text>
        <Text style={pg.secSub}>{secs.length} sections</Text>
        <Rule dark />
        <Text style={pg.secCnt}>{cnt} Graduates</Text>
        {secs.length ? <View style={pg.ngrid}>{secs.slice(0,16).map((n,i) => <Text key={`${n}-${i}`} style={pg.ngi}>Section {n}</Text>)}</View> : null}
      </View>
    </Shell>
  );
}

function SectionPage({ page }: { page: any }) {
  const sec  = page?.section || {};
  const stds = Array.isArray(sec?.students) ? sec.students : [];
  const secN = sec?.name || ptitle(page,'Class Section');
  const c    = ft(sec?.course, sec?.strand, page?.course, pcopy(page), 'Course');
  return (
    <Shell tone="dark">
      <Text style={pg.secWm}>{String(secN).slice(0,6).toUpperCase()}</Text>
      <View style={pg.secBody}>
        <Text style={pg.kickDark}>Section</Text>
        <Text style={pg.secTit}>{secN}</Text>
        <Text style={pg.secSub}>{c}</Text>
        <Rule dark />
        <Text style={pg.secCnt}>{sec?.studentCount ?? stds.length} Graduates</Text>
        {sec?.adviser ? <Text style={pg.secAdv}>Adviser: {sec.adviser}</Text> : null}
      </View>
      {stds.length ? <View style={pg.ngrid}>{stds.slice(0,18).map((s: any, i: number) => <Text key={String(s?.id||i)} style={pg.ngi}>{sname(s)}</Text>)}</View> : null}
    </Shell>
  );
}

function GalPage({ page }: { page: any }) {
  const g = page?.gallery || {};
  const photos = galPhotos(g);
  return (
    <Shell tone="cream">
      <Head eyebrow="Memories" title={g?.name || ptitle(page,'Gallery')} body={pcopy(page)} />
      {photos.length
        ? <View style={pg.pgrid}>{photos.map((ph: any, i: number) => <View key={`${ph.url}-${i}`} style={pg.ptile}><Image source={ph.url} style={pg.pimg} contentFit="cover" />{ph.caption ? <Text style={pg.pcap} numberOfLines={2}>{ph.caption}</Text> : null}</View>)}</View>
        : <Text style={pg.body}>No gallery photos on this page yet.</Text>}
    </Shell>
  );
}

function DirPage({ page }: { page: any }) {
  const stds = Array.isArray(page?.students) ? page.students : [];
  return (
    <Shell tone="cream">
      <Head eyebrow="Graduate" title="Directory" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {stds.slice(0,30).map((s: any, i: number) => (
          <View key={String(s?.id||i)} style={pg.drow}><Text style={pg.dname}>{sname(s)}</Text><Text style={pg.dcrs}>{scourse(s)}</Text></View>
        ))}
      </ScrollView>
    </Shell>
  );
}

function FacPage({ page }: { page: any }) {
  const fac = Array.isArray(page?.faculty) ? page.faculty.slice(0,2) : [];
  return (
    <Shell tone="paper">
      <Head eyebrow="Our Faculty" title="Mentors & Guides" />
      <View style={pg.facList}>
        {fac.length ? fac.map((m: any, i: number) => {
          const n = m?.name || m?.full_name || 'Faculty';
          const ph = psrc(m?.photo || m?.image || m?.image_url || m?.profile_picture);
          return (
            <View key={String(m?.id||i)} style={pg.facCard}>
              {ph ? <Image source={ph} style={pg.facP} contentFit="cover" /> : <View style={pg.facPFb}><Text style={pg.facInit}>{initials(n)}</Text></View>}
              <View style={pg.facInfo}>
                <Text style={pg.facN} numberOfLines={2}>{n}</Text>
                <Text style={pg.facR} numberOfLines={2}>{m?.title || m?.department || 'Faculty'}</Text>
                <Text style={pg.facB} numberOfLines={5}>{m?.bio || 'Guiding students with excellence.'}</Text>
              </View>
            </View>
          );
        }) : <Text style={pg.body}>Faculty profiles will appear here once added.</Text>}
      </View>
    </Shell>
  );
}

function ColPage({ page, type }: { page: any; type: string }) {
  const stds  = Array.isArray(page?.students) ? page.students : [];
  const fac   = Array.isArray(page?.faculty)  ? page.faculty  : [];
  const stats = statPairs(page?.stats);
  const items = fac.length ? fac : stds;
  const titles: Record<string, string> = { achievements:'Achievements', organizations:'Organizations', memories:'Campus Memories', aspirations:'Future Aspirations', faculty:'Faculty', stats:'Class Statistics' };
  return (
    <Shell tone="cream">
      <Head eyebrow="Yearbook" title={titles[type] || ptitle(page)} />
      {stats.length ? <View style={pg.sgrid}>{stats.map(([l,v]) => <View key={l} style={pg.sbox}><Text style={pg.sv}>{v}</Text><Text style={pg.sl}>{l}</Text></View>)}</View> : null}
      {items.slice(0,5).map((it: any, i: number) => (
        <View key={String(it?.id||i)} style={pg.crow}>
          <View style={pg.cav}><Text style={pg.cinit}>{initials(it?.name || it?.full_name || 'SB')}</Text></View>
          <View style={{ flex:1, minWidth:0 }}>
            <Text style={pg.cname}>{it?.name || it?.full_name || 'Entry'}</Text>
            <Text style={pg.csub} numberOfLines={2}>{ft(it?.achievements, it?.organizations, it?.fondest_memory, it?.future_plans, it?.bio, it?.role, it?.title, it?.course)}</Text>
          </View>
        </View>
      ))}
      {!stats.length && !items.length ? <Text style={pg.body}>No entries added yet.</Text> : null}
    </Shell>
  );
}

function EditPage({ page, index, yn }: { page: any; index: number; yn: string }) {
  const type = ptype(page);
  const tMap: Record<string,string> = { dedication:'Dedication', welcome:'Welcome Message', 'program-overview':'Program Overview', closing:'Closing' };
  const bMap: Record<string,string> = { dedication:'A celebration of every graduate, adviser, class memory, and milestone.', welcome:'Welcome to the official mobile yearbook reader.', 'program-overview':'Introducing the class, sections, and achievements in this yearbook.', closing:`Thank you for reading ${yn}.` };
  return (
    <Shell tone={type === 'dedication' ? 'dark' : 'paper'}>
      <Head eyebrow={yn} title={ptitle(page, tMap[type] || `Page ${index + 1}`)} body={pcopy(page, bMap[type] || '')} dark={type === 'dedication'} />
    </Shell>
  );
}

// Master page switcher
const YBPage = React.memo(function YBPage({ page, index, yn }: { page: any; index: number; yn: string }) {
  const t = ptype(page);
  if (t === 'cover' || t === 'back-cover') return <CoverPage page={page} yn={yn} />;
  if (t === 'toc')              return <TocPage page={page} index={index} />;
  if (t === 'welcome')          return <MsgPage page={page} />;
  if (t === 'program-overview') return <ProgPage page={page} />;
  if (t === 'stats')            return <StatsPage page={page} />;
  if (t === 'student-profile' || page?.student) return <StudentPage page={page} />;
  if (t === 'course-header')    return <CoursePage page={page} />;
  if (t === 'section-header')   return <SectionPage page={page} />;
  if (t === 'gallery')          return <GalPage page={page} />;
  if (t === 'directory')        return <DirPage page={page} />;
  if (t === 'faculty')          return <FacPage page={page} />;
  if (['achievements','organizations','memories','aspirations'].includes(t)) return <ColPage page={page} type={t} />;
  return <EditPage page={page} index={index} yn={yn} />;
});

// Main screen 
export default function YearbookScreen() {
  const router = useRouter();
  const { batchId: reqBatchId, pageIndex: reqPageIdx, view: reqView } = useLocalSearchParams();
  const targetIdx  = typeof reqPageIdx === 'string' ? reqPageIdx : '';
  const openOnLoad = reqView === '1' || reqView === 'true';

  const [batches,    setBatches]    = useState<any[]>([]);
  const [selBatch,   setSelBatch]   = useState<any>(null);
  const [ybMeta,     setYbMeta]     = useState<any>(null);
  const [pages,      setPages]      = useState<any[]>([]);
  const [galleries,  setGalleries]  = useState<any[]>([]);
  const [bookmarks,  setBookmarks]  = useState<any[]>([]);
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState<any[]>([]);
  const [readerOpen, setReaderOpen] = useState(false);
  const [jumpOpen,   setJumpOpen]   = useState(false);
  const [jumpQ,      setJumpQ]      = useState('');
  const [loading,    setLoading]    = useState(true);
  const [dlLoading,  setDlLoading]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');
  const [appCfg,     setAppCfg]     = useState<any>(null);
  const [curUser,    setCurUser]    = useState<any>(null);
  const [upgradeVisible, setUpgradeVisible] = useState(false);

  // Single atomic flip state 
  const [flip, setFlip] = useState<FlipState>(makeFlipState(0, null));

  const flipProg  = useSharedValue(0);
  const flipAnim  = useSharedValue(false);
  const flipDirSV = useSharedValue<1|-1>(1);
  const isAnim    = useRef(false);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDone  = useRef(false);
  const manClosed = useRef(false);

  const features   = appCfg?.features || {};
  const ybEnabled  = features.enable_flipbook_viewer !== false;
  const pdfEnabled = features.enable_yearbook_pdf_download !== false;
  const premiumEnabled = features.enable_premium_subscription !== false;
  const canAccessYb = !premiumEnabled || isPaid(curUser);
  const canPdf     = pdfEnabled && canAccessYb;
  const ybName     = appCfg?.yearbook_name || 'Sinag-Bughaw Digital Yearbook';

  const visible = useMemo(() => results.length ? results : pages, [pages, results]);

  const clearAutoOpen = useCallback((replace = false) => {
    autoDone.current = true;
    if (reqView === '1' || reqView === 'true') {
      const params = reqBatchId ? { batchId: String(reqBatchId) } : {};
      if (replace) router.replace({ pathname: '/yearbook', params } as any);
      else         router.setParams({ view: '0' } as any);
    }
  }, [reqBatchId, reqView, router]);

  // finishFlip: called from worklet via runOnJS 
  const finishFlip = useCallback(() => {
    setFlip(prev => ({
      phase: 'idle',
      currentIndex: prev.targetIndex,
      currentPage:  prev.targetPage,
      targetIndex:  prev.targetIndex,
      targetPage:   null,
      dir: prev.dir,
    }));

    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      flipProg.value = 0;
      flipAnim.value = false;
      isAnim.current = false;
    }, 50);
  }, [flipAnim, flipProg]);

  // startFlip: single setState one render no flicker
  const startFlip = useCallback((dir: 1 | -1) => {
    if (isAnim.current) return;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }

    setFlip(prev => {
      const fromIndex = prev.currentIndex;
      const toIndex   = fromIndex + dir;
      if (toIndex < 0 || toIndex >= visible.length) return prev;

      const fromPage = visible[fromIndex];
      const toPage   = visible[toIndex];

      flipDirSV.value = dir;
      flipAnim.value  = true;
      flipProg.value  = 0;
      isAnim.current  = true;

      return {
        phase: 'animating',
        currentIndex: fromIndex,
        currentPage:  fromPage,
        targetIndex:  toIndex,
        targetPage:   toPage,
        dir,
      };
    });

    if (flipTimer.current) clearTimeout(flipTimer.current);
    // FIX 1: FLIP_PREP_MS is now 0 animation starts immediately on mount
    // so the target page never has a visible window before animation begins.
    flipTimer.current = setTimeout(() => {
      flipTimer.current = null;
      flipProg.value = withTiming(1, {
        duration: FLIP_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      }, () => {
        runOnJS(finishFlip)();
      });
    }, FLIP_PREP_MS);
  }, [finishFlip, flipAnim, flipDirSV, flipProg, visible]);

  const goPage = useCallback((dir: 1 | -1) => { startFlip(dir); }, [startFlip]);

  const closeReader = useCallback(() => {
    manClosed.current = true;
    clearAutoOpen(true);
    setReaderOpen(false);
    setFlip(makeFlipState(0, null));
    setJumpOpen(false);
    setJumpQ('');
    if (flipTimer.current) clearTimeout(flipTimer.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    flipDirSV.value = 1;
    isAnim.current  = false;
    flipAnim.value  = false;
    flipProg.value  = 0;
  }, [clearAutoOpen, flipAnim, flipDirSV, flipProg]);

  useEffect(() => {
    let alive = true;
    getAppConfig().then(p => { if (alive) setAppCfg(unwrap(p)); }).catch(() => { if (alive) setAppCfg(null); });
    fetchCurrentUser().then(u => { if (alive) setCurUser(u); }).catch(() => { if (alive) setCurUser(null); });
    return () => {
      alive = false;
      if (flipTimer.current) clearTimeout(flipTimer.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  const openBatch = useCallback(async (batch: any, openReaderAfter = false) => {
    if (!ybEnabled) return;

    if (!canAccessYb) {
      setUpgradeVisible(true);
      return;
    }

    setSelBatch(batch);
    setDlLoading(true);
    setYbMeta(null); setPages([]); setGalleries([]); setBookmarks([]); setReaderOpen(false);
    setFlip(makeFlipState(0, null));
    const id = bid(batch);
    if (!id) { setDlLoading(false); return; }
    setError('');
    recordContentView({ content_type:'yearbook_batch', content_id:Number(id), title:btitle(batch), category:String(batch?.year||'yearbook'), url:`/yearbook/${id}` }).catch(()=>{});
    if (openReaderAfter) await generateYearbook(id).catch(()=>null);
    const [mR,pR,bR,gR] = await Promise.allSettled([getYearbookMeta(id), getYearbookPages(id), getYearbookBookmarks(id), getYearbookGalleries(id)]);
    if (mR.status === 'fulfilled') setYbMeta(unwrap(mR.value));
    let nPages: any[] = [];
    if (pR.status === 'fulfilled') { const raw = unwrap(pR.value); nPages = Array.isArray(raw) ? raw : raw?.pages || []; }
    else setError(getErrorMessage((pR as any).reason, 'Unable to load flipbook pages.'));
    let nGals: any[] = [];
    if (bR.status === 'fulfilled') { const raw = unwrap(bR.value); setBookmarks(Array.isArray(raw) ? raw : []); }
    if (gR.status === 'fulfilled') { const raw = unwrap(gR.value); nGals = Array.isArray(raw) ? raw : raw?.data || []; setGalleries(nGals); }
    if (!nPages.length) nPages = buildPages(batch, nGals);
    setPages(nPages);
    if (openReaderAfter && nPages.length) {
      const n = Number(targetIdx);
      const i = Number.isFinite(n) && n > 0 ? Math.min(nPages.length-1, n-1) : 0;
      setFlip(makeFlipState(i, nPages[i]));
      setReaderOpen(true);
    }
    setDlLoading(false);
  }, [canAccessYb, targetIdx, ybEnabled]);

  const loadBatches = useCallback(async () => {
    if (!ybEnabled) { setBatches([]); setLoading(false); setRefreshing(false); return; }
    try {
      setError('');
      if (!refreshing) setLoading(true);
      const payload = await getYearbookBatches();
      const next    = flatten(payload);
      setBatches(next);
      if (reqBatchId && !selBatch) {
        const tgt = next.find((x: any) => String(bid(x)) === String(reqBatchId));
        if (tgt) {
          if (openOnLoad) clearAutoOpen();
          openBatch(tgt, false);
        }
      }
    } catch (e: any) { setError(getErrorMessage(e, 'Unable to load yearbooks.')); }
    finally { setLoading(false); setRefreshing(false); }
  }, [clearAutoOpen, openBatch, openOnLoad, refreshing, reqBatchId, selBatch, ybEnabled]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const runSearch = async () => {
    if (!selBatch || !query.trim()) { setResults([]); return; }
    try { const d = unwrap(await searchYearbook(bid(selBatch), query.trim())); setResults(Array.isArray(d) ? d : []); }
    catch (e: any) { Alert.alert('Search failed', getErrorMessage(e, 'Unable to search.')); }
  };

  const bmForPage = (p: any, i: number) => { const pi = p?.pageIndex ?? p?.page_index ?? p?.index ?? i; return bookmarks.find(b => String(b?.page_index ?? b?.pageIndex) === String(pi)); };
  const bmPage = async (p: any, i: number) => {
    if (!selBatch) return;
    try {
      await addYearbookBookmark({ batch_id:bid(selBatch), page_index:p?.pageIndex ?? p?.index ?? i, label:p?.label || p?.title || `Page ${i+1}` });
      const d = unwrap(await getYearbookBookmarks(bid(selBatch))); setBookmarks(Array.isArray(d) ? d : []);
      Alert.alert('Bookmarked', 'Page added to your bookmarks.');
    } catch (e: any) { Alert.alert('Bookmark failed', getErrorMessage(e, 'Unable to bookmark.')); }
  };
  const rmBm = async (bm: any) => {
    const id = bm?.id || bm?.bookmark_id;
    if (!id || !selBatch) return;
    try {
      await removeYearbookBookmark(id);
      const d = unwrap(await getYearbookBookmarks(bid(selBatch))); setBookmarks(Array.isArray(d) ? d : []);
      Alert.alert('Removed', 'Bookmark removed.');
    } catch (e: any) { Alert.alert('Remove failed', getErrorMessage(e, 'Unable to remove.')); }
  };

  const openPdf = async () => {
    if (!pdfEnabled) { Alert.alert('PDF disabled', 'PDF downloads are currently disabled.'); return; }
    if (!canPdf)     { setUpgradeVisible(true); return; }
    const id = bid(selBatch); if (!id) return;
    try { await Linking.openURL(await getMobileYearbookPdfUrl(id)); }
    catch (e: any) { Alert.alert('PDF unavailable', getErrorMessage(e, 'Unable to open PDF.')); }
  };

  const openReader = (index: number) => {
    if (!canAccessYb) {
      setUpgradeVisible(true);
      return;
    }
    manClosed.current = false;
    autoDone.current  = true;
    clearAutoOpen();
    const nextIndex = Math.max(0, Math.min(index, Math.max(visible.length - 1, 0)));
    setFlip(makeFlipState(nextIndex, visible[nextIndex]));
    setReaderOpen(true);
    const p = visible[nextIndex];
    const cid = Number(p?.id || p?.pageIndex || p?.index || nextIndex+1);
    if (cid > 0) recordContentView({ content_type:'yearbook_page', content_id:cid, title:plabel(p,nextIndex), category:btitle(selBatch), url:`/yearbook/${bid(selBatch)}/page/${pnum(p,nextIndex)}` }).catch(()=>{});
  };

  const jumpTo = (t: any) => {
    const nextIndex = Math.max(0, Math.min(t.index, pages.length-1));
    setResults([]);
    setFlip(makeFlipState(nextIndex, pages[nextIndex]));
    setJumpOpen(false);
    setJumpQ('');
  };

  const jumpTargets = useMemo(() => {
    const byKey = new Map<string, any>();
    pages.forEach((p, i) => {
      const sec = p?.section || {};
      const c   = ft(sec?.course, sec?.strand, p?.course?.name, p?.course);
      const sn  = ft(sec?.name, p?.section_name, p?.label);
      const t   = ptype(p);
      const cands = [
        c  ? { kind:'Course',  label:c,  subtitle:sn || `Page ${pnum(p,i)}` } : null,
        sn && (t === 'section-header' || p?.student) ? { kind:'Section', label:sn, subtitle:c || `Page ${pnum(p,i)}` } : null,
      ].filter(Boolean) as any[];
      cands.forEach(cd => { const k = `${cd.kind}:${cd.label}`.toLowerCase(); if (!byKey.has(k)) byKey.set(k, { ...cd, index:i, pageNumber:pnum(p,i) }); });
    });
    const term = jumpQ.trim().toLowerCase();
    return Array.from(byKey.values()).filter(t => !term || `${t.kind} ${t.label} ${t.subtitle}`.toLowerCase().includes(term)).sort((a,b) => a.pageNumber - b.pageNumber).slice(0,30);
  }, [pages, jumpQ]);

  // Derived display values
  const displayIndex = flip.currentIndex;
  const displayPage  = flip.currentPage || visible[flip.currentIndex] || null;

  const stageFromPage  = flip.currentPage  || visible[flip.currentIndex] || null;
  const stageFromIndex = flip.currentIndex;
  const stageToPage    = flip.targetPage;
  const stageToIndex   = flip.targetIndex;
  const stageFromKey   = `${stageFromIndex}-${stageFromPage?.id ?? stageFromPage?.pageIndex ?? ptype(stageFromPage)}`;
  const stageToKey     = `${stageToIndex}-${stageToPage?.id ?? stageToPage?.pageIndex ?? ptype(stageToPage)}`;

  // FIX 2: Current page fades out only in the final 15% of the animation
  // Previously the current page had no opacity control it would snap-disappear
  // when backfaceVisibility kicked in, causing a blank-frame flash.
  // Now it gently fades out at the very end, giving a seamless handoff.
  const curStyle = useAnimatedStyle(() => {
    'worklet';
    const rotate  = -flipDirSV.value * flipProg.value * FLIP_OPEN_DEG;
    const hinge   = -flipDirSV.value * (PAGE_W / 2);
    // Keep fully visible until 85% through, then fade out cleanly
    const opacity = flipProg.value > 0.85
      ? Math.max(0, (1 - flipProg.value) / 0.15)
      : 1;
    return {
      zIndex: 2,
      opacity,
      transform: [
        { perspective: 1200 },
        { translateX: hinge },
        { rotateY: `${rotate}deg` },
        { translateX: -hinge },
      ],
      backfaceVisibility: 'hidden',
    };
  });

  // FIX 3: Target page starts fully invisible (opacity: 0)
  // The old code set opacity:1 immediately on mount, causing a flash during
  // the FLIP_PREP_MS window and on the very first render frame.
  // Now the target is invisible at flipProg=0 and only begins revealing itself
  // after the current page has rotated 45% of the way by which point it's
  // visually behind the rotating page anyway.
  const nxtStyle = useAnimatedStyle(() => {
    'worklet';
    // Hidden until current page is 45% rotated; then smoothly reveal
    const revealProgress = Math.max(0, (flipProg.value - 0.45) / 0.55);
    return {
      zIndex: 1,
      opacity: revealProgress,
      transform: [{ perspective: 1200 }],
    };
  });

  const curShadowStyle = useAnimatedStyle(() => {
    'worklet';
    const peak = flipProg.value < 0.5 ? flipProg.value * 2 : (1 - flipProg.value) * 2;
    return { opacity: Math.max(0, Math.min(0.38, peak * 0.38)) };
  });

  // FIX 4: Shadow also keyed to revealProgress no shadow flash on mount
  const nxtShadowStyle = useAnimatedStyle(() => {
    'worklet';
    const revealProgress = Math.max(0, (flipProg.value - 0.45) / 0.55);
    return { opacity: Math.max(0, 0.18 * revealProgress * (1 - flipProg.value)) };
  });

  // Pan gesture
  const pan = useMemo(() => Gesture.Pan()
    .onUpdate(e => {
      if (flipAnim.value) return;
      const dir = e.translationX < 0 ? 1 : -1;
      const atEdge = (dir === 1 && flip.currentIndex >= visible.length-1) || (dir === -1 && flip.currentIndex <= 0);
      const raw = Math.abs(e.translationX) / SW;
      flipProg.value = Math.min(0.4, atEdge ? raw * 0.05 : raw);
      if (raw > 0.02) flipDirSV.value = dir;
    })
    .onEnd(e => {
      if (flipAnim.value) return;
      if      (e.translationX < -60 && flip.currentIndex < visible.length-1) runOnJS(startFlip)(1);
      else if (e.translationX >  60 && flip.currentIndex > 0)                runOnJS(startFlip)(-1);
      else    flipProg.value = withTiming(0, { duration:140 });
    }),
  [flipAnim, flipDirSV, flipProg, flip.currentIndex, startFlip, visible.length]);

  // Unavailable
  if (!ybEnabled) return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <View style={s.centered}>
        <View style={s.unavIcon}><FontAwesome name="book" size={24} color={GOLD} /></View>
        <Text style={s.unavTitle}>Yearbook Unavailable</Text>
        <Text style={s.unavBody}>The digital yearbook viewer is currently disabled.</Text>
        <TouchableOpacity style={s.goldBtn} onPress={() => router.replace('/(tabs)/home' as any)}>
          <FontAwesome name="home" size={14} color={NAVY} /><Text style={s.goldBtnT}>Go Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  // Batch list
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity style={s.hBack} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home' as any)} activeOpacity={0.85}>
          <FontAwesome name="chevron-left" size={16} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.hTitle}>Yearbook</Text>
      </View>

      <FlatList
        data={batches}
        keyExtractor={(item, i) => String(bid(item)||i)}
        ListHeaderComponent={
          premiumEnabled && !canAccessYb ? (
            <TouchableOpacity style={s.upgradeBanner} activeOpacity={0.9} onPress={() => setUpgradeVisible(true)}>
              <View style={{ flex: 1 }}>
                <Text style={s.upgradeTitle}>Yearbook locked</Text>
                <Text style={s.upgradeText}>Upgrade to Standard or Premium to open flipbooks and download PDFs.</Text>
              </View>
              <View style={s.upgradeButton}><Text style={s.upgradeButtonText}>Upgrade</Text></View>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          const cover = imageUrl(item?.coverUrl || item?.cover_url || item?.cover);
          return (
            <TouchableOpacity style={s.bCard} onPress={() => openBatch(item, true)} activeOpacity={0.88}>
              {cover ? <Image source={cover} style={s.bCover} /> : <View style={s.bCoverFb}><FontAwesome name="book" size={22} color={GOLD} /></View>}
              <View style={s.bInfo}><Text style={s.bTitle}>{btitle(item)}</Text><Text style={s.bMeta}>{byear(item)||item?.status||'Flipbook'}</Text></View>
              <FontAwesome name={canAccessYb ? 'chevron-right' : 'lock'} size={13} color={MUTED} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={loading ? <ActivityIndicator color={NAVY} style={{ marginTop:32 }} /> : <Text style={s.empty}>{error||'No yearbooks found.'}</Text>}
        contentContainerStyle={s.listPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBatches(); }} />}
      />

      {/* Batch detail modal */}
      <Modal visible={!!selBatch} animationType="slide" onRequestClose={() => setSelBatch(null)}>
        <SafeAreaView style={s.root}>
          <View style={s.dHeader}>
            <TouchableOpacity onPress={() => setSelBatch(null)} style={s.dBack}><FontAwesome name="chevron-left" size={18} color={NAVY} /></TouchableOpacity>
            <Text style={s.dTitle} numberOfLines={1}>{btitle(selBatch)}</Text>
            <View style={s.bmBadge}><FontAwesome name="bookmark" size={12} color={NAVY} />{bookmarks.length ? <Text style={s.bmBadgeN}>{bookmarks.length}</Text> : null}</View>
          </View>

          <View style={s.searchRow}>
            <TextInput style={s.searchIn} placeholder="Search flipbook..." value={query} onChangeText={setQuery} onSubmitEditing={runSearch} returnKeyType="search" />
            <TouchableOpacity style={s.searchBtn} onPress={runSearch}><FontAwesome name="search" size={15} color={WHITE} /></TouchableOpacity>
          </View>

          {pdfEnabled ? (
            <TouchableOpacity style={[s.actBtn, s.actBtnSec, !canPdf && s.actLocked]} onPress={openPdf}>
              <FontAwesome name={canPdf ? 'file-pdf-o' : 'lock'} size={14} color={GOLD} />
              <Text style={s.actBtnSecT}>{canPdf ? 'Download PDF' : 'PDF Download Locked'}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={[s.actBtn, s.actBtnPri]} onPress={() => pages.length ? openReader(0) : selBatch && openBatch(selBatch, true)} disabled={dlLoading}>
            {dlLoading ? <ActivityIndicator color={NAVY} size="small" /> : <FontAwesome name="book" size={14} color={NAVY} />}
            <Text style={s.actBtnPriT}>{dlLoading ? 'Generating...' : 'Open Flipbook'}</Text>
          </TouchableOpacity>

          <FlatList
            data={visible}
            keyExtractor={(item, i) => String(item?.id || item?.pageIndex || i)}
            ListHeaderComponent={(
              <View>
                {ybMeta ? (
                  <View style={s.metaCard}>
                    <Text style={s.metaK}>Digital Yearbook</Text>
                    <Text style={s.metaT}>{ybMeta?.title || btitle(selBatch)}</Text>
                    <Text style={s.metaSub}>{ybMeta?.school || ybName} Â· {ybMeta?.year || byear(selBatch)}</Text>
                  </View>
                ) : null}
                {galleries.length ? (
                  <View style={s.galSec}>
                    <Text style={s.secH}>Yearbook Galleries</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap:12, paddingRight:8 }}>
                      {galleries.map((g, i) => {
                        const cv = galCover(g);
                        return (
                          <View key={String(g?.id||i)} style={s.galCard}>
                            {cv ? <Image source={cv} style={s.galImg} contentFit="cover" /> : <View style={s.galFb}><FontAwesome name="image" size={20} color={GOLD} /></View>}
                            <Text style={s.galT} numberOfLines={2}>{galTitle(g)}</Text>
                            <Text style={s.galM}>{galCount(g)} items</Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}
                <Text style={s.secH}>Pages</Text>
              </View>
            )}
            renderItem={({ item, index }) => {
              const bm = bmForPage(item, index);
              const hi = targetIdx && String(item?.pageIndex ?? item?.index ?? index) === targetIdx;
              return (
                <TouchableOpacity style={[s.pgCard, hi && s.pgCardHi]} onPress={() => openReader(index)} activeOpacity={0.88}>
                  <Text style={s.pgNum}>PAGE {pnum(item, index)}</Text>
                  <Text style={s.pgTitle}>{plabel(item, index)}</Text>
                  <Text style={s.pgExc} numberOfLines={2}>{pcopy(item, 'Tap to read this page.')}</Text>
                  <TouchableOpacity style={s.bmBtn} onPress={() => bm ? rmBm(bm) : bmPage(item, index)}>
                    <FontAwesome name={bm ? 'bookmark' : 'bookmark-o'} size={13} color={NAVY} />
                    <Text style={s.bmBtnT}>{bm ? 'Remove bookmark' : 'Bookmark'}</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={dlLoading ? <ActivityIndicator color={NAVY} style={{ marginTop:32 }} /> : (
              <View style={s.centered}>
                <Text style={s.empty}>{error||'No flipbook pages found.'}</Text>
                <TouchableOpacity style={[s.actBtn, s.actBtnPri, { marginHorizontal:0, width:180 }]} onPress={() => selBatch && openBatch(selBatch, true)}>
                  <FontAwesome name="refresh" size={13} color={NAVY} /><Text style={s.actBtnPriT}>Generate Flipbook</Text>
                </TouchableOpacity>
              </View>
            )}
            contentContainerStyle={s.listPad}
          />

          {/* Reader modal */}
          <Modal visible={readerOpen} animationType="slide" onRequestClose={closeReader}>
            <SafeAreaView style={s.rdRoot}>
              <StatusBar style="light" />

              {/* Reader header */}
              <View style={s.rdHeader}>
                <TouchableOpacity style={s.rdIcon} onPress={closeReader}><FontAwesome name="chevron-left" size={16} color={WHITE} /></TouchableOpacity>
                <View style={s.rdTitleW}>
                  <Text style={s.rdKick}>PAGE {displayPage ? pnum(displayPage, displayIndex) : '-'} / {visible.length}</Text>
                  <Text style={s.rdTitle} numberOfLines={1}>{displayPage ? readerPageLabel(displayPage, displayIndex) : 'Yearbook'}</Text>
                </View>
                <TouchableOpacity style={s.rdIcon} onPress={() => displayPage && bmPage(displayPage, displayIndex)}>
                  <FontAwesome name="bookmark-o" size={16} color={GOLD} />
                </TouchableOpacity>
              </View>

              {/* Stage */}
              <GestureDetector gesture={pan}>
                <View style={s.stage}>
                  {/* Current (departing) page always visible, fades out at the end of flip */}
                  <Reanimated.View
                    key={`from-${stageFromKey}`}
                    renderToHardwareTextureAndroid={flip.phase === 'animating'}
                    shouldRasterizeIOS={flip.phase === 'animating'}
                    style={[s.pageSlot, flip.phase === 'animating' ? curStyle : null]}
                  >
                    {stageFromPage ? <YBPage key={stageFromKey} page={stageFromPage} index={stageFromIndex} yn={ybName} /> : null}
                    {flip.phase === 'animating' ? (
                      <Reanimated.View pointerEvents="none" style={[s.pageShadow, curShadowStyle]} />
                    ) : null}
                  </Reanimated.View>

                  {/*
                    FIX 5: Target page â€” mounted only during animating phase.
                    Starts at opacity:0 (via nxtStyle) and only becomes visible
                    after the departing page has rotated past 45%.
                    Using flip.phase directly (not the derived `isAnimating` const)
                    avoids any potential stale-closure timing gap.
                  */}
                  {flip.phase === 'animating' && stageToPage ? (
                    <Reanimated.View
                      key={`to-${stageToKey}`}
                      renderToHardwareTextureAndroid
                      shouldRasterizeIOS
                      style={[s.pageSlot, nxtStyle]}
                    >
                      <YBPage key={stageToKey} page={stageToPage} index={stageToIndex} yn={ybName} />
                      <Reanimated.View pointerEvents="none" style={[s.pageShadow, nxtShadowStyle]} />
                    </Reanimated.View>
                  ) : null}

                  {/* Tap zones */}
                  <TouchableOpacity accessibilityLabel="Previous page" activeOpacity={1} disabled={flip.currentIndex <= 0} onPress={() => goPage(-1)} style={[s.tap, s.tapL]} />
                  <TouchableOpacity accessibilityLabel="Next page"     activeOpacity={1} disabled={flip.currentIndex >= visible.length-1} onPress={() => goPage(1)} style={[s.tap, s.tapR]} />
                </View>
              </GestureDetector>

              {/* Progress bar */}
              <View style={s.progTrack}>
                <View style={[s.progFill, { width:`${visible.length ? ((displayIndex+1)/visible.length)*100 : 0}%` as any }]} />
              </View>

              {/* Nav */}
              <View style={s.nav}>
                <TouchableOpacity style={[s.navBtn, flip.currentIndex <= 0 && s.navDis]} onPress={() => goPage(-1)} disabled={flip.currentIndex <= 0}>
                  <FontAwesome name="chevron-left" size={13} color={NAVY} /><Text style={s.navT}>Previous</Text>
                </TouchableOpacity>
                <Text style={s.navCnt}>{displayIndex+1} / {visible.length}</Text>
                <TouchableOpacity style={[s.navBtn, flip.currentIndex >= visible.length-1 && s.navDis]} onPress={() => goPage(1)} disabled={flip.currentIndex >= visible.length-1}>
                  <Text style={s.navT}>Next</Text><FontAwesome name="chevron-right" size={13} color={NAVY} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={s.findBtn} onPress={() => setJumpOpen(true)} activeOpacity={0.88}>
                <FontAwesome name="search" size={12} color={GOLD} /><Text style={s.findT}>Find course or section</Text>
              </TouchableOpacity>

              {pdfEnabled ? (
                <TouchableOpacity style={[s.pdfBtn, !canPdf && s.pdfLocked]} onPress={openPdf}>
                  <FontAwesome name={canPdf ? 'file-pdf-o' : 'lock'} size={13} color={NAVY} />
                  <Text style={s.pdfT}>{canPdf ? 'Download Full PDF' : 'PDF Download Locked'}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Jump sheet */}
              <Modal visible={jumpOpen} transparent animationType="fade" onRequestClose={() => setJumpOpen(false)}>
                <View style={s.jOver}>
                  <View style={s.jSheet}>
                    <View style={s.jHandle} />
                    <View style={s.jHd}><Text style={s.jHdT}>Jump to Course or Section</Text><TouchableOpacity style={s.jClose} onPress={() => setJumpOpen(false)}><FontAwesome name="times" size={13} color={MUTED} /></TouchableOpacity></View>
                    <View style={s.jSearch}><FontAwesome name="search" size={13} color={MUTED} /><TextInput style={s.jIn} value={jumpQ} onChangeText={setJumpQ} placeholder="Search BSA, BSCS, 4-A..." placeholderTextColor={MUTED} /></View>
                    <ScrollView style={{ maxHeight:360 }} showsVerticalScrollIndicator={false}>
                      {jumpTargets.length ? jumpTargets.map(t => (
                        <TouchableOpacity key={`${t.kind}-${t.label}`} style={s.jRow} onPress={() => jumpTo(t)} activeOpacity={0.86}>
                          <View style={s.jIcon}><FontAwesome name={t.kind === 'Course' ? 'graduation-cap' : 'bookmark'} size={11} color={GOLD} /></View>
                          <View style={{ flex:1, minWidth:0 }}>
                            <Text style={s.jRowT} numberOfLines={1}>{t.label}</Text>
                            <Text style={s.jRowS} numberOfLines={1}>{t.kind} Â· {t.subtitle} Â· p.{t.pageNumber}</Text>
                          </View>
                        </TouchableOpacity>
                      )) : <Text style={s.jEmpty}>No matching course or section found.</Text>}
                    </ScrollView>
                  </View>
                </View>
              </Modal>
            </SafeAreaView>
          </Modal>
        </SafeAreaView>
      </Modal>
      <UpgradePrompt
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        title="Unlock Yearbook"
        featureLabel="flipbook viewing and PDF downloads"
      />
    </SafeAreaView>
  );
}

// Styles
const s = StyleSheet.create({
  root:        { flex:1, backgroundColor:BG },
  centered:    { flex:1, alignItems:'center', justifyContent:'center', padding:28 },
  listPad:     { padding:16, paddingBottom:120 },
  upgradeBanner: {
    marginBottom: 14,
    borderRadius: 16,
    backgroundColor: '#263187',
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  upgradeTitle: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  upgradeText: { color: '#d8dff4', fontSize: 11, marginTop: 2 },
  upgradeButton: {
    height: 38,
    borderRadius: 11,
    backgroundColor: GOLD,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeButtonText: { color: NAVY, fontSize: 11, fontWeight: '900' },

  header:  { backgroundColor:NAVY, paddingHorizontal:20, paddingVertical:16, flexDirection:'row', alignItems:'center', gap:14 },
  hBack:   { width:42, height:42, borderRadius:13, backgroundColor:WHITE, alignItems:'center', justifyContent:'center' },
  hTitle:  { color:GOLD, fontSize:22, fontWeight:'900' },

  bCard:     { flexDirection:'row', alignItems:'center', backgroundColor:WHITE, borderRadius:16, padding:14, marginBottom:10, elevation:2, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:8, shadowOffset:{width:0,height:3} },
  bCover:    { width:54, height:70, borderRadius:9, marginRight:14, backgroundColor:'#E5E7EB' },
  bCoverFb:  { width:54, height:70, borderRadius:9, marginRight:14, backgroundColor:NAVY, alignItems:'center', justifyContent:'center' },
  bInfo:     { flex:1 },
  bTitle:    { color:'#1C1C1E', fontSize:16, fontWeight:'800' },
  bMeta:     { color:MUTED, fontSize:13, marginTop:3 },
  empty:     { color:MUTED, textAlign:'center', padding:28, fontSize:14 },

  unavIcon:  { width:64, height:64, borderRadius:18, backgroundColor:NAVY, alignItems:'center', justifyContent:'center', marginBottom:16 },
  unavTitle: { color:NAVY, fontSize:20, fontWeight:'900', textAlign:'center' },
  unavBody:  { color:MUTED, fontSize:14, lineHeight:22, textAlign:'center', marginTop:8, marginBottom:20 },
  goldBtn:   { height:46, borderRadius:13, backgroundColor:GOLD, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, paddingHorizontal:20 },
  goldBtnT:  { color:NAVY, fontSize:14, fontWeight:'900' },

  actBtn:      { marginHorizontal:16, marginBottom:8, height:48, borderRadius:14, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  actBtnPri:   { backgroundColor:GOLD },
  actBtnPriT:  { color:NAVY, fontSize:14, fontWeight:'900' },
  actBtnSec:   { backgroundColor:NAVY },
  actBtnSecT:  { color:WHITE, fontSize:14, fontWeight:'800' },
  actLocked:   { opacity:0.55 },

  dHeader:    { flexDirection:'row', alignItems:'center', paddingHorizontal:18, paddingVertical:14, borderBottomWidth:1, borderBottomColor:'#E5E7EB', gap:12 },
  dBack:      { width:38, height:38, borderRadius:11, backgroundColor:BG, alignItems:'center', justifyContent:'center' },
  dTitle:     { flex:1, color:'#1C1C1E', fontSize:17, fontWeight:'800' },
  bmBadge:    { flexDirection:'row', alignItems:'center', backgroundColor:BG, borderRadius:10, paddingHorizontal:9, paddingVertical:5, gap:5 },
  bmBadgeN:   { color:NAVY, fontWeight:'800', fontSize:12 },

  searchRow:  { flexDirection:'row', paddingHorizontal:16, paddingVertical:10, backgroundColor:WHITE, gap:10 },
  searchIn:   { flex:1, height:44, backgroundColor:BG, borderRadius:12, paddingHorizontal:14, fontSize:14, color:'#1C1C1E' },
  searchBtn:  { width:44, height:44, borderRadius:12, backgroundColor:NAVY, alignItems:'center', justifyContent:'center' },

  metaCard: { backgroundColor:NAVY, borderRadius:16, padding:18, marginBottom:14 },
  metaK:    { color:GOLD, fontSize:10, fontWeight:'900', letterSpacing:1.2, textTransform:'uppercase' },
  metaT:    { color:WHITE, fontSize:19, fontWeight:'900', marginTop:5 },
  metaSub:  { color:'rgba(255,255,255,0.65)', fontSize:12, marginTop:4 },
  secH:     { color:NAVY, fontSize:14, fontWeight:'900', marginBottom:10 },

  galSec:  { marginBottom:14 },
  galCard: { width:144, borderRadius:12, backgroundColor:WHITE, borderWidth:1, borderColor:'#E5E7EB', overflow:'hidden' },
  galImg:  { width:'100%', height:90, backgroundColor:'#E5E7EB' },
  galFb:   { width:'100%', height:90, backgroundColor:NAVY, alignItems:'center', justifyContent:'center' },
  galT:    { color:NAVY, fontSize:12, fontWeight:'800', padding:8, paddingBottom:2 },
  galM:    { color:MUTED, fontSize:11, paddingHorizontal:8, paddingBottom:8 },

  pgCard:    { backgroundColor:WHITE, borderRadius:16, padding:16, marginBottom:10, elevation:2 },
  pgCardHi:  { borderWidth:2, borderColor:GOLD },
  pgNum:     { color:MUTED, fontSize:10, fontWeight:'800', letterSpacing:1.2, textTransform:'uppercase' },
  pgTitle:   { color:'#1C1C1E', fontSize:16, fontWeight:'800', marginTop:4 },
  pgExc:     { color:'#4A4A4A', fontSize:13, lineHeight:19, marginTop:6 },
  bmBtn:     { flexDirection:'row', alignItems:'center', gap:7, marginTop:10 },
  bmBtnT:    { color:NAVY, fontSize:12, fontWeight:'700' },

  rdRoot:    { flex:1, backgroundColor:NAVY },
  rdHeader:  { flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingVertical:10, gap:10, borderBottomWidth:1, borderBottomColor:'rgba(255,255,255,0.08)' },
  rdIcon:    { width:40, height:40, borderRadius:12, backgroundColor:'rgba(255,255,255,0.1)', alignItems:'center', justifyContent:'center' },
  rdTitleW:  { flex:1, minWidth:0 },
  rdKick:    { color:GOLD, fontSize:10, fontWeight:'800', letterSpacing:1.2 },
  rdTitle:   { color:WHITE, fontSize:16, fontWeight:'900', marginTop:2 },

  stage:    { height:PAGE_H + 20, overflow:'hidden', paddingHorizontal:14, paddingVertical:10 },
  pageSlot: { position:'absolute', top:10, left:14, right:14, height:PAGE_H, borderRadius:16, overflow:'hidden', backgroundColor:PAPER },
  pageShadow: { position:'absolute', top:0, right:0, bottom:0, left:0, backgroundColor:'rgba(0,0,0,0.4)', borderRadius:16 },
  tap:      { position:'absolute', top:0, bottom:0, width:'20%', zIndex:10 },
  tapL:     { left:14 },
  tapR:     { right:14 },

  progTrack: { height:3, backgroundColor:'rgba(255,255,255,0.1)', marginHorizontal:14 },
  progFill:  { height:'100%', backgroundColor:GOLD, borderRadius:2 },

  nav:    { flexDirection:'row', alignItems:'center', gap:10, paddingHorizontal:14, paddingTop:10, paddingBottom:8 },
  navBtn: { flex:1, height:46, borderRadius:13, backgroundColor:GOLD, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:7 },
  navDis: { opacity:0.4 },
  navT:   { color:NAVY, fontSize:13, fontWeight:'900' },
  navCnt: { minWidth:60, textAlign:'center', color:WHITE, fontSize:13, fontWeight:'800' },

  findBtn: { marginHorizontal:14, marginBottom:8, height:42, borderRadius:12, borderWidth:1, borderColor:'rgba(229,168,32,0.4)', backgroundColor:'rgba(255,255,255,0.06)', flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  findT:   { color:WHITE, fontSize:13, fontWeight:'800' },
  pdfBtn:  { marginHorizontal:14, marginBottom:14, height:46, borderRadius:13, backgroundColor:WHITE, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  pdfLocked: { backgroundColor:'#E2E8F0' },
  pdfT:    { color:NAVY, fontSize:13, fontWeight:'900' },

  jOver:   { flex:1, backgroundColor:'rgba(13,27,62,0.6)', justifyContent:'flex-end' },
  jSheet:  { maxHeight:'75%', backgroundColor:WHITE, borderTopLeftRadius:22, borderTopRightRadius:22, paddingHorizontal:16, paddingBottom:24 },
  jHandle: { width:40, height:4, backgroundColor:'#E5E7EB', borderRadius:2, alignSelf:'center', marginTop:10, marginBottom:8 },
  jHd:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:10 },
  jHdT:    { color:NAVY, fontSize:16, fontWeight:'900' },
  jClose:  { width:34, height:34, borderRadius:10, backgroundColor:BG, alignItems:'center', justifyContent:'center' },
  jSearch: { flexDirection:'row', alignItems:'center', backgroundColor:BG, borderRadius:12, paddingHorizontal:12, height:44, marginBottom:10, gap:8 },
  jIn:     { flex:1, color:NAVY, fontSize:14, fontWeight:'700' },
  jRow:    { flexDirection:'row', alignItems:'center', gap:10, paddingVertical:11, borderBottomWidth:1, borderBottomColor:BG },
  jIcon:   { width:32, height:32, borderRadius:10, backgroundColor:NAVY, alignItems:'center', justifyContent:'center' },
  jRowT:   { color:NAVY, fontSize:14, fontWeight:'800' },
  jRowS:   { color:MUTED, fontSize:11, fontWeight:'700', marginTop:1 },
  jEmpty:  { color:MUTED, textAlign:'center', paddingVertical:24, fontSize:13 },
});

// Page styles
const pg = StyleSheet.create({
  shell:     { flex:1, backgroundColor:PAPER, padding:20, overflow:'hidden', borderRadius:16 },
  shellDark: { backgroundColor:NAVY },
  shellCream:{ backgroundColor:CREAM },
  fo:        { position:'absolute', top:8, right:8, bottom:8, left:8, borderWidth:1, borderColor:'rgba(201,168,76,0.6)' },
  fi:        { position:'absolute', top:13, right:13, bottom:13, left:13, borderWidth:1, borderColor:'rgba(255,255,255,0.55)' },
  foDark:    { borderColor:'rgba(201,168,76,0.7)' },
  fiDark:    { borderColor:'rgba(255,255,255,0.15)' },

  head:      { marginBottom:12, zIndex:1 },
  kick:      { color:GOLDDIM, fontSize:10, fontWeight:'900', letterSpacing:2, textTransform:'uppercase' },
  kickDark:  { color:GOLD, fontSize:10, fontWeight:'900', letterSpacing:2, textTransform:'uppercase' },
  disp:      { color:'#172033', fontSize:30, lineHeight:34, fontWeight:'900', marginTop:5 },
  dispDark:  { color:WHITE },
  rule:      { width:56, height:2.5, backgroundColor:GOLDDIM, marginTop:10, marginBottom:12, borderRadius:2 },
  ruleDark:  { backgroundColor:GOLD },
  body:      { color:'rgba(23,32,51,0.75)', fontSize:14, lineHeight:22 },
  bodyDark:  { color:'rgba(255,255,255,0.78)', fontStyle:'italic' },
  infoBox:   { flex:1, minWidth:80 },
  infoL:     { color:GOLDDIM, fontSize:8, fontWeight:'900', letterSpacing:1, textTransform:'uppercase' },
  infoV:     { color:'rgba(23,32,51,0.75)', fontSize:11, lineHeight:15, marginTop:3 },

  cwm:   { position:'absolute', top:60, alignSelf:'center', color:'rgba(255,255,255,0.04)', fontSize:140, lineHeight:140, fontWeight:'900' },
  cc:    { flex:1, alignItems:'center', justifyContent:'center' },
  csc:   { color:GOLDDIM, fontSize:10, fontWeight:'900', letterSpacing:2, textTransform:'uppercase', textAlign:'center' },
  ctitle:{ color:GOLD, fontSize:38, lineHeight:42, fontWeight:'900', textAlign:'center', textTransform:'uppercase', marginTop:14 },
  ctheme:{ color:'rgba(255,255,255,0.75)', fontSize:11, letterSpacing:1.2, fontWeight:'800', textAlign:'center', marginTop:4, textTransform:'uppercase' },
  cyw:   { alignItems:'center', marginTop:16 },
  cco:   { color:WHITE, fontSize:16, fontWeight:'600', fontStyle:'italic' },
  cy:    { color:GOLD, fontSize:80, lineHeight:84, fontWeight:'900', letterSpacing:-3 },
  cedb:  { borderWidth:1.5, borderColor:'rgba(201,168,76,0.6)', paddingHorizontal:20, paddingVertical:8, marginTop:12 },
  cedt:  { color:WHITE, fontSize:10, fontWeight:'900', letterSpacing:2 },
  cac:   { color:'rgba(255,255,255,0.45)', fontSize:9, fontWeight:'800', letterSpacing:1.5, marginTop:16, textTransform:'uppercase' },
  cstats:{ flexDirection:'row', gap:10, marginTop:16 },
  cstat: { borderWidth:1, borderColor:'rgba(201,168,76,0.3)', paddingHorizontal:16, paddingVertical:8, alignItems:'center', minWidth:90 },
  csv:   { color:GOLD, fontSize:22, fontWeight:'900' },
  csl:   { color:'rgba(255,255,255,0.6)', fontSize:9, fontWeight:'800', textTransform:'uppercase', letterSpacing:1 },

  tocList:{ flex:1 },
  tocRow: { flexDirection:'row', gap:12, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'rgba(201,168,76,0.3)' },
  tocN:   { width:36, color:GOLDDIM, fontSize:22, fontWeight:'900', lineHeight:26 },
  tocT:   { flex:1 },
  tocL:   { color:'#172033', fontSize:15, fontWeight:'800', lineHeight:20 },
  tocP:   { color:MUTED, fontSize:10, fontWeight:'800', marginTop:2, letterSpacing:1, textTransform:'uppercase' },

  msgSig: { borderTopWidth:1, borderTopColor:'rgba(216,199,162,0.6)', marginTop:20, paddingTop:14 },
  msgA:   { color:'#172033', fontSize:18, fontWeight:'800', marginBottom:4 },

  sgrid: { flexDirection:'row', flexWrap:'wrap', gap:10, marginTop:12 },
  sbox:  { width:'47%', backgroundColor:NAVY, padding:12, borderRadius:10 },
  sv:    { color:GOLD, fontSize:26, fontWeight:'900' },
  sl:    { color:'rgba(255,255,255,0.7)', fontSize:9, fontWeight:'800', textTransform:'uppercase', letterSpacing:1, marginTop:4 },

  bBlock:{ marginTop:14 },
  bTitle:{ color:'#172033', fontSize:10, fontWeight:'900', letterSpacing:1.2, textTransform:'uppercase', marginBottom:8 },
  bRow:  { flexDirection:'row', alignItems:'center', gap:8, marginBottom:7 },
  bL:    { width:80, color:'rgba(23,32,51,0.75)', fontSize:10, fontWeight:'800', textTransform:'uppercase' },
  bTrack:{ flex:1, height:8, backgroundColor:CREAMD, borderRadius:4, overflow:'hidden' },
  bFill: { height:'100%', backgroundColor:NAVY, borderRadius:4 },
  bV:    { width:24, textAlign:'right', color:'#172033', fontSize:10, fontWeight:'900' },

  stHd:   { marginBottom:10 },
  stLay:  { flex:1, flexDirection:'row', gap:14 },
  stPW:   { width:'44%', backgroundColor:CREAMD, borderRadius:10, overflow:'hidden' },
  stP:    { width:'100%', height:'100%' },
  stPFb:  { width:'100%', flex:1, backgroundColor:NAVY, alignItems:'center', justifyContent:'center' },
  stInit: { color:GOLD, fontSize:40, fontWeight:'900' },
  stInfo: { flex:1, justifyContent:'center', gap:4 },
  honor:  { backgroundColor:GOLD, alignSelf:'flex-start', paddingHorizontal:8, paddingVertical:4, borderRadius:5, marginBottom:4 },
  honorT: { color:NAVY, fontSize:9, fontWeight:'900', letterSpacing:0.5 },
  stN:    { color:NAVY, fontSize:18, lineHeight:21, fontWeight:'900', textTransform:'uppercase' },
  stC:    { color:MUTED, fontSize:9, fontWeight:'800', letterSpacing:0.8, textTransform:'uppercase', marginTop:6 },
  qBlock: { flexDirection:'row', alignItems:'flex-start', gap:8, marginTop:10 },
  qAcc:   { width:2.5, backgroundColor:GOLD, alignSelf:'stretch', borderRadius:2, minHeight:20 },
  qTxt:   { flex:1, color:'rgba(23,32,51,0.8)', fontSize:11, lineHeight:17, fontStyle:'italic' },
  facts:  { flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:10, borderTopWidth:1, borderTopColor:'rgba(201,168,76,0.3)', paddingTop:10 },
  stGrid: { flexDirection:'row', flexWrap:'wrap', gap:8 },
  stCard: { width:'47%', borderWidth:1, borderColor:'rgba(201,168,76,0.35)', backgroundColor:'rgba(255,255,255,0.7)', padding:10, borderRadius:8, minHeight:64 },
  stTxt:  { color:'rgba(23,32,51,0.75)', fontSize:11, lineHeight:16, marginTop:5 },
  stFoot: { flexDirection:'row', flexWrap:'wrap', gap:10, borderTopWidth:1, borderTopColor:'rgba(201,168,76,0.3)', paddingTop:10, marginTop:8 },

  secWm:  { position:'absolute', top:60, left:0, right:0, textAlign:'center', color:'rgba(255,255,255,0.04)', fontSize:130, fontWeight:'900', textTransform:'uppercase', lineHeight:130 },
  secBody:{ flex:1, justifyContent:'center', zIndex:1 },
  secTit: { color:GOLD, fontSize:52, lineHeight:56, fontWeight:'900', marginTop:8, textTransform:'uppercase' },
  secSub: { color:'rgba(255,255,255,0.7)', fontSize:12, fontWeight:'800', letterSpacing:1.2, textTransform:'uppercase', marginTop:6 },
  secCnt: { color:WHITE, fontSize:20, fontStyle:'italic', marginTop:8 },
  secAdv: { color:'rgba(255,255,255,0.6)', fontSize:12, marginTop:6 },
  ngrid:  { flexDirection:'row', flexWrap:'wrap', gap:6, marginTop:12 },
  ngi:    { color:WHITE, backgroundColor:'rgba(255,255,255,0.08)', borderWidth:1, borderColor:'rgba(201,168,76,0.2)', paddingHorizontal:8, paddingVertical:5, fontSize:11, fontWeight:'700', borderRadius:4 },

  pgrid:  { flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:12 },
  ptile:  { width:'47%', backgroundColor:PAPER, borderWidth:1, borderColor:'rgba(201,168,76,0.4)', borderRadius:8, overflow:'hidden' },
  pimg:   { width:'100%', height:100, backgroundColor:CREAMD },
  pcap:   { color:MUTED, fontSize:9, padding:7, lineHeight:13 },

  drow:  { paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#E5E7EB' },
  dname: { color:NAVY, fontSize:14, fontWeight:'800' },
  dcrs:  { color:MUTED, fontSize:12, marginTop:2 },

  facList: { gap:12, marginTop:8 },
  facCard: { flexDirection:'row', gap:12, borderWidth:1, borderColor:'rgba(201,168,76,0.35)', backgroundColor:'rgba(255,255,255,0.7)', padding:12, borderRadius:10 },
  facP:    { width:80, height:100, borderRadius:8, backgroundColor:CREAMD },
  facPFb:  { width:80, height:100, borderRadius:8, backgroundColor:CREAMD, alignItems:'center', justifyContent:'center' },
  facInit: { color:NAVY, fontSize:24, fontWeight:'900' },
  facInfo: { flex:1, justifyContent:'center' },
  facN:    { color:'#172033', fontSize:18, fontWeight:'900', lineHeight:22 },
  facR:    { color:GOLDDIM, fontSize:10, fontWeight:'900', textTransform:'uppercase', letterSpacing:1, marginTop:6 },
  facB:    { color:'rgba(23,32,51,0.65)', fontSize:11, lineHeight:16, marginTop:8 },

  crow:  { flexDirection:'row', alignItems:'center', gap:10, paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#E5E7EB' },
  cav:   { width:36, height:36, borderRadius:10, backgroundColor:NAVY, alignItems:'center', justifyContent:'center' },
  cinit: { color:GOLD, fontSize:13, fontWeight:'900' },
  cname: { color:NAVY, fontSize:13, fontWeight:'800' },
  csub:  { color:MUTED, fontSize:11, marginTop:2 },
});

