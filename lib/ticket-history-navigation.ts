type TicketNoticeParams={eventDate?:string|string[];inputEvent?:string|string[]};
const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
function validDate(value:string|undefined):value is string{
 return Boolean(value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T12:00:00Z"))&&new Date(value+"T12:00:00Z").toISOString().slice(0,10)===value);
}

/** Older notices identify a business day, without proving a particular edit. */
export function legacyTicketNoticeDate(params:TicketNoticeParams){
 const event=one(params.inputEvent),day=one(params.eventDate);
 return !event?.trim()&&validDate(day)?day:undefined;
}

export function ticketNotificationDate(params:TicketNoticeParams&{date?:string|string[]}){
 const event=one(params.inputEvent),day=one(params.eventDate);
 return event&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event)&&validDate(day)?day:legacyTicketNoticeDate(params)??one(params.date);
}
