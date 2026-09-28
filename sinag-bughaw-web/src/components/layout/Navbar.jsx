import { Link, useLocation }          from 'react-router-dom';
import { useAuth }                     from '../../features/auth/hooks/useAuth';
import { storageUrl }                  from '@/api/client';
import NotificationBell                from '@/components/feedback/NotificationBell';
import { useState, useRef, useEffect } from 'react';
import { messagesApi }                 from '@/api/messaging.api';
import { useAppConfig }                from '@/features/platform/AppConfigProvider';
import { getSubscriptionTier }         from '@/utils/subscription';

// tier helper (shared logic)
const getTier = (user) => getSubscriptionTier(user);

// hook: live unread message count
function useUnreadMessages() {
  const [count, setCount] = useState(0);
  const location = useLocation();

  const refresh = async () => {
    try {
      const { data } = await messagesApi.unreadCount();
      setCount(data.unread_count ?? 0);
    } catch { /* silently ignore */ }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    window.addEventListener('messaging:unread-updated', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('messaging:unread-updated', refresh);
    };
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith('/messages')) setCount(0);
  }, [location.pathname]);

  return count;
}

// tiny badge
function UnreadBadge({ count }) {
  if (!count || count < 1) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black
                     min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center
                     border-[1.5px] border-[#1d2b4b] pointer-events-none leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

// tier badge
function TierBadge({ tier }) {
  if (tier === 'premium') return (
    <span className="inline-flex items-center gap-1 bg-gradient-to-r from-[#fdb813] to-[#e5a70e] text-[#1d2b4b] text-[9px] font-black px-1.5 py-0.5 rounded leading-none">
      <i className="fas fa-crown text-[7px]" aria-hidden="true" /> Premium
    </span>
  );
  if (tier === 'standard') return (
    <span className="inline-flex items-center gap-1 bg-indigo-500/25 text-indigo-300 text-[9px] font-bold px-1.5 py-0.5 rounded leading-none">
      <i className="fas fa-star text-[7px]" aria-hidden="true" /> Standard
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 bg-white/10 text-white/40 text-[9px] font-semibold px-1.5 py-0.5 rounded leading-none">
      <i className="fas fa-user text-[7px]" aria-hidden="true" /> Free
    </span>
  );
}

// nav links config
const NAV_LINKS = [
  { to: '/dashboard', label: 'Home'      },
  { to: '/directory', label: 'Directory' },
  { to: '/faculty',   label: 'Faculty'   },
  { to: '/gallery',   label: 'Gallery'   },
  { to: '/sections',  label: 'Batch'     },
  { to: '/discover',  label: 'Discovery' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/alumni', label: 'Alumni' },
];

const BASE_DROP_ITEMS = [
  { icon: 'fa-user',      color: 'text-indigo-400', label: 'View Profile', toFn: (u) => `/profile/${u?.id}` },
  { icon: 'fa-cog',       color: 'text-slate-400',  label: 'Settings',    toFn: ()   => '/settings'        },
];

// Premium dropdown item varies by tier
const getPremiumDropItem = (tier) => {
  if (tier === 'premium') return null;
  if (tier === 'standard') return {
    icon: 'fa-star', color: 'text-indigo-400', label: 'Upgrade to Premium', toFn: () => '/premium',
  };
  return {
    icon: 'fa-crown', color: 'text-amber-400', label: 'Go Premium', toFn: () => '/premium',
  };
};

// component
export default function Navbar() {
  const { user, logout } = useAuth();
  const { isOn }         = useAppConfig();
  const location         = useLocation();
  const [dropOpen, setDropOpen]     = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropRef        = useRef(null);
  const unreadMessages = useUnreadMessages();

  const userTier = getTier(user);

  const navLinks = NAV_LINKS.filter((link) => {
    if (link.to === '/directory') return isOn('enable_student_directory_search');
    return true;
  });

  const dropItems = [
    ...BASE_DROP_ITEMS,
    ...(isOn('enable_premium_subscription') ? [getPremiumDropItem(userTier)] : []),
  ].filter(Boolean);

  const avatarSrc =
    storageUrl(user?.profile_picture) ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name ?? 'U')}&background=fdb813&color=1d2b4b&size=64`;

  const initials  = user?.name?.split(' ').map(n => n[0]).slice(0, 2).join('') ?? 'U';
  const firstName = user?.name?.split(' ')[0] ?? '';

  // close dropdown on outside click
  useEffect(() => {
    const h = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleLogout = async () => { setDropOpen(false); await logout(); };

  const isActive = (to) =>
    location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <>
      <nav className="sticky top-0 z-[1000] h-16 bg-[#1d2b4b] shadow-[0_2px_24px_rgba(0,0,0,0.2)]
                      flex items-center justify-between px-4 sm:px-6 lg:px-10">

        {/* Logo */}
        <Link to="/dashboard" className="no-underline flex items-center gap-2.5 shrink-0">
          <img src="/images/NU_logo.png" alt="NU Lipa" className="w-9 h-9 object-contain" />
          <div className="hidden sm:flex flex-col gap-0.5 leading-none">
            <span className="text-white font-black text-[13px] uppercase tracking-widest">Sinag-Bughaw</span>
            <span className="text-[#fdb813] text-[9px] font-semibold uppercase tracking-[0.18em]">
              National University Lipa
            </span>
          </div>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden lg:flex items-center gap-0.5">
          {navLinks.map(({ to, label }) => (
            <Link
              key={to} to={to}
              className={`no-underline text-[13px] px-4 py-1.5 rounded-lg transition-all duration-150 font-medium
                ${isActive(to)
                  ? 'text-[#fdb813] bg-[#fdb813]/12 font-semibold'
                  : 'text-white/60 hover:text-white hover:bg-white/8'
                }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5">

          {/* Notification bell */}
          <NotificationBell />

          {/* Messages */}
          <Link
            to="/messages"
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center no-underline transition-all duration-150
              ${isActive('/messages')
                ? 'text-[#fdb813] bg-[#fdb813]/12'
                : 'text-white/60 hover:text-white hover:bg-white/8'
              }`}
            aria-label="Messages"
          >
            <i className="fas fa-comment-dots text-base" aria-hidden="true" />
            <UnreadBadge count={unreadMessages} />
          </Link>

          {/* Divider */}
          <div className="w-px h-5 bg-white/10 mx-1" aria-hidden="true" />

          {/* Avatar + dropdown */}
          <div ref={dropRef} className="relative">
            <button
              onClick={() => setDropOpen(v => !v)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-xl border-none cursor-pointer transition-all duration-150
                ${dropOpen ? 'bg-white/12' : 'bg-transparent hover:bg-white/8'}`}
            >
              {/* Avatar */}
              <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#fdb813] flex items-center justify-center shrink-0 border border-[#fdb813]/40">
                {user?.profile_picture ? (
                  <img
                    src={avatarSrc} alt={user?.name}
                    className="w-full h-full object-cover block"
                    onError={e => {
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.parentNode.innerHTML = `<span class="text-[12px] font-bold text-[#1d2b4b]">${initials}</span>`;
                    }}
                  />
                ) : (
                  <span className="text-[12px] font-black text-[#1d2b4b]">{initials}</span>
                )}
              </div>

              {/* Name + tier hidden on small screens */}
              <div className="hidden sm:flex flex-col gap-0.5 text-left">
                <span className="text-white text-[13px] font-semibold leading-none">{firstName}</span>
                <TierBadge tier={userTier} />
              </div>

              <i
                className={`fas fa-chevron-down text-[9px] text-white/40 ml-0.5 transition-transform duration-150
                  ${dropOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {/* Dropdown */}
            {dropOpen && (
              <div className="absolute top-[calc(100%+8px)] right-0 w-52 bg-white rounded-2xl
                              shadow-[0_12px_40px_rgba(29,43,75,0.18)] border border-slate-100
                              overflow-hidden z-[9999] animate-[dropIn_0.18s_cubic-bezier(0.34,1.2,0.64,1)]">
                <style>{`@keyframes dropIn{from{opacity:0;transform:translateY(-8px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>

                {/* User info header with tier badge */}
                <div className="px-4 py-3.5 border-b border-slate-100 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#fdb813] flex items-center justify-center shrink-0 border border-[#fdb813]/40">
                      {user?.profile_picture ? (
                        <img src={avatarSrc} alt={user?.name} className="w-full h-full object-cover block" />
                      ) : (
                        <span className="text-[13px] font-black text-[#1d2b4b]">{initials}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-[13px] font-bold text-[#1d2b4b] m-0 truncate">{user?.name}</p>
                        {userTier === 'premium' && (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-50 text-amber-600 border border-amber-100 shrink-0">
                            <i className="fas fa-crown text-[9px]" aria-hidden="true" />
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 m-0 truncate">{user?.email}</p>
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                {dropItems.map(({ icon, color, label, toFn }) => (
                  <Link
                    key={label}
                    to={toFn(user)}
                    onClick={() => setDropOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 no-underline text-[#1d2b4b] text-[13px] font-medium
                               border-b border-slate-50 hover:bg-[#f4f7fe] transition-colors"
                  >
                    <i className={`fas ${icon} ${color} text-[13px] w-4 text-center`} aria-hidden="true" />
                    {label}
                  </Link>
                ))}

                {/* Log out */}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 border-none bg-white text-red-500
                             text-[13px] font-semibold cursor-pointer border-t border-slate-100
                             hover:bg-red-50 transition-colors text-left"
                >
                  <i className="fas fa-sign-out-alt text-[13px] w-4 text-center" aria-hidden="true" />
                  Log Out
                </button>
              </div>
            )}
          </div>

          {/* Hamburger (mobile) */}
          <button
            className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-white/60 hover:text-white
                       hover:bg-white/8 transition-all border-none cursor-pointer ml-1"
            onClick={() => setMobileOpen(v => !v)}
            aria-label="Toggle menu"
          >
            <i className={`fas ${mobileOpen ? 'fa-times' : 'fa-bars'} text-base`} aria-hidden="true" />
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed top-16 left-0 right-0 z-[999] bg-[#1d2b4b]/98 backdrop-blur-lg
                        border-b border-white/10 px-4 py-3 shadow-xl">
          <div className="flex flex-col gap-0.5">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to} to={to}
                onClick={() => setMobileOpen(false)}
                className={`no-underline text-sm font-medium px-3 py-2.5 rounded-xl transition-colors
                  ${isActive(to)
                    ? 'text-[#fdb813] bg-[#fdb813]/12 font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/8'
                  }`}
              >
                {label}
              </Link>
            ))}

            {/* Mobile tier indicator */}
            <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between px-3 py-2">
              <span className="text-[11px] text-white/40 font-medium">Your Plan</span>
              <TierBadge tier={userTier} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
