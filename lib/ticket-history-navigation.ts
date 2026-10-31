export function ticketNotificationDate(params:{date?:string|string[];eventDate?:string|string[];inputEvent?:string|string[]}){
 const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
 const event=one(params.inputEvent),day=one(params.eventDate);
 return event&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event)&&day&&/^\d{4}-\d{2}-\d{2}$/.test(day)?day:one(params.date);
}
