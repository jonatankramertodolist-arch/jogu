import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Idag', icon: TodayIcon },
  { to: '/schema', label: 'Schema', icon: CalendarIcon },
  { to: '/coach', label: 'Coach', icon: ChatIcon },
  { to: '/mal', label: 'Mål', icon: TargetIcon },
  { to: '/installningar', label: 'Mer', icon: GearIcon },
];

export default function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <main className="safe-top flex-1">
        <Outlet />
      </main>

      <nav className="safe-bottom fixed bottom-0 left-1/2 z-20 w-full max-w-lg -translate-x-1/2 border-t border-base-700/60 bg-base-900/95 pt-1.5 backdrop-blur-xl">
        <ul className="flex">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <li key={tab.to} className="flex-1">
                <NavLink
                  to={tab.to}
                  end={tab.to === '/'}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1 py-1.5 text-[10px] font-medium transition-colors ${
                      isActive ? 'text-run' : 'text-faint'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon active={isActive} />
                      {tab.label}
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

interface IconProps {
  active: boolean;
}

function iconProps(active: boolean) {
  return {
    width: 23,
    height: 23,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2.2 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

function TodayIcon({ active }: IconProps) {
  return (
    <svg {...iconProps(active)}>
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </svg>
  );
}

function CalendarIcon({ active }: IconProps) {
  return (
    <svg {...iconProps(active)}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function ChatIcon({ active }: IconProps) {
  return (
    <svg {...iconProps(active)}>
      <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8Z" />
    </svg>
  );
}

function TargetIcon({ active }: IconProps) {
  return (
    <svg {...iconProps(active)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

function GearIcon({ active }: IconProps) {
  return (
    <svg {...iconProps(active)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.2M12 18.8V21M4.6 7.8l1.9 1.1M17.5 15.1l1.9 1.1M4.6 16.2l1.9-1.1M17.5 8.9l1.9-1.1" />
    </svg>
  );
}
