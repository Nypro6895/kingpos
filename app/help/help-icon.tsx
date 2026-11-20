type Icon = "screen"|"start"|"calendar"|"receipt"|"team"|"reward"|"gift"|"profile"|"settings"|"book";
const paths:Record<Icon,string>={
  screen:"M3 4h18v13H3zM8 21h8M12 17v4",
  start:"M14 3c4-1 7 0 7 0s1 3 0 7l-8 8-7-7 8-8ZM6 11l-3 1-1 5 5-1M13 18l-1 4 5-1 1-4M6 18l-3 3M15 7h.01",
  calendar:"M4 5h16v16H4zM8 2v6M16 2v6M4 10h16M8 14h2M14 14h2M8 18h2",
  receipt:"M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 7h6M9 11h6M9 15h3",
  team:"M16 21v-3a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v3M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 3a4 4 0 0 1 0 7M21 21v-3a4 4 0 0 0-3-4",
  reward:"m12 2 3 2 4 1 1 4 2 3-2 3-1 4-4 1-3 2-3-2-4-1-1-4-2-3 2-3 1-4 4-1 3-2Zm0 5 1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5L7 10.5l3.5-.5L12 7Z",
  gift:"M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z",
  profile:"M20 21a8 8 0 0 0-16 0M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  settings:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3H9Z",
  book:"M5 4h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3V4Zm0 13h14M9 8h6M9 11h5",
};
export function HelpIcon({slug}:{slug:string}) {
  const icon:Icon=/windows|pos-and/.test(slug)?"screen":slug==="overview"?"start":/booking|find-and-book|schedule/.test(slug)?"calendar":/gift/.test(slug)?"gift":/reward/.test(slug)?"reward":/staff|customers/.test(slug)?"team":/checkout|payroll|report|receipt|check-writer|owner-tips/.test(slug)?"receipt":/profile|account|library/.test(slug)?"profile":/settings|security|notifications/.test(slug)?"settings":"book";
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[icon]}/></svg>;
}
