// One vocabulary for the overview, search results and editor headings.
export const settingCopy = {
  'personal-profile': {label:'Profile & contact', description:'Name, email, phone and time zone', icon:'user'},
  'personal-public': {label:'Public profile', description:'Bio, cover image and visibility', icon:'eye'},
  'login-security': {label:'Login & security', description:'Password, verification and signed-in devices', icon:'lock'},
  'blocked-users': {label:'Blocked users', description:'Manage who can contact you', icon:'blocked'},
  notifications: {label:'Notifications', description:'Choose which updates you receive', icon:'bell'},
  connections: {label:'Connections & invitations', description:'Connected salons and pending invitations', icon:'link'},
  'delete-account': {label:'Delete personal account', description:'Review account deletion and its impact', icon:'trash', danger:true},
  'salon-profile': {label:'Salon information', description:'Contact, address and opening hours', icon:'store'},
  'public-profile': {label:'Website & public profile', description:'Photos, appearance and publishing', icon:'globe'},
  services: {label:'Services & prices', description:'Services, prices and eligible booking staff', icon:'scissors'},
  booking: {label:'Booking rules', description:'Booking times, availability and preferences', icon:'calendar'},
  'staff-team': {label:'Team & invitations', description:'Staff, access and public team', icon:'team'},
  payroll: {label:'Payroll', description:'Pay cycle and staff payroll', icon:'wallet'},
  'pos-display': {label:'POS & devices', description:'POS access, devices and customer display', icon:'device'},
  shortcuts: {label:'Today shortcuts', description:'Choose your workspace quick actions', icon:'grid'},
  ownership: {label:'Ownership', description:'Owners, transfer and ownership history', icon:'key'},
  'close-salon': {label:'Salon status & closure', description:'Status, backup and permanent closure', icon:'archive', danger:true},
  'staff-profile': {label:'Staff profile & preferences', description:'Public profile and booking preferences', icon:'badge'},
  'staff-schedule': {label:'Working hours & time off', description:'Weekly availability and time off', icon:'clock'},
  'create-salon': {label:'Add salon', description:'Create a salon workspace', icon:'plus'},
  'legal-policies': {label:'Policies & terms', description:'Terms, privacy and community standards', icon:'document'},
  'help-support': {label:'Help & support', description:'Support requests and account recovery', icon:'help'},
} as const;
export type SettingsCopy = {label:string;description:string;icon:string;danger?:boolean};
export function getSettingCopy(groupId:string, itemId:string): SettingsCopy {
  const key = groupId.startsWith('staff-') ? itemId.endsWith('-schedule') ? 'staff-schedule' : 'staff-profile'
    : Object.keys(settingCopy).find(key => itemId === key || itemId === `${groupId}-${key}`);
  return key ? settingCopy[key as keyof typeof settingCopy] : {label:itemId,description:'',icon:'help'};
}
export function settingsCategories(groupId:string): {title:string;keys:string[]}[] {
  if(groupId==='personal') return [
    {title:'Profile',keys:['personal-profile','personal-public']},
    {title:'Security & privacy',keys:['login-security','blocked-users']},
    {title:'Preferences',keys:['notifications','connections']},
    {title:'Account actions',keys:['delete-account']},
  ];
  if(groupId.startsWith('salon-')) return [
    {title:'Salon',keys:['salon-profile','public-profile']},
    {title:'Services & booking',keys:['services','booking']},
    {title:'People & pay',keys:['staff-team','payroll']},
    {title:'Workspace',keys:['pos-display','shortcuts']},
    {title:'Owner controls',keys:['ownership','close-salon']},
  ];
  return [];
}
