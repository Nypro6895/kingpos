import type { ReactNode } from 'react';

export function SettingsIcon({name}:{name:string}) {
  const paths:Record<string,ReactNode>={
    user:<><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    store:<><path d="M3 10 5 3h14l2 7M4 13v8h16v-8M9 21v-6h6v6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></>,
    eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    lock:<><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/></>,
    blocked:<><circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 11-6m4 2 5 5m0-5-5 5"/></>,
    bell:<><path d="M4 18h16l-2-3V9a6 6 0 0 0-12 0v6zM9 21h6"/></>,
    link:<><path d="m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/></>,
    trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
    globe:<><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></>,
    scissors:<><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 13M8 16 20 3"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-13 5 3 3 5-5"/></>,
    team:<><circle cx="9" cy="8" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 5a3 3 0 0 1 0 6m3 4a6 6 0 0 1 3 6"/></>,
    wallet:<><path d="M20 7V4H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V7m19 7h-6v4h6"/></>,
    device:<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 22h8m-4-5v5"/></>,
    grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    key:<><circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m-6 0 3-3"/></>,
    archive:<><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v13h16V8m-11 5h6"/></>,
    badge:<><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 2h6v4H9zM8 17h8"/><circle cx="12" cy="12" r="2"/></>,
    clock:<><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    plus:<path d="M12 4v16M4 12h16"/>,
    document:<><path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h8"/></>,
    search:<><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,
    help:<><circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 4 3c-1 1-1 2-1 3m0 3v1"/></>,
  };
  return <svg className="settings-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-settings-icon={name}>{paths[name]||paths.help}</svg>;
}
