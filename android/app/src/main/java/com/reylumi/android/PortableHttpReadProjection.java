package com.reylumi.android;

import java.net.URLDecoder;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import org.json.JSONArray;

/** Projects two existing read-only HTTP views from native-authorized DTOs.
 * This helper grants no authority: the caller must check the current native
 * admission, capability, document and network-failure boundary. Cache.read is
 * the native transport's scoped, cookie/revision/lease-checked lookup only. */
final class PortableHttpReadProjection {
    interface Cache { JSONObject read(String name, JSONObject args, String scope) throws Exception; }

    static final class Request {
        final String name, capability, date;
        private final String dateField;
        private Request(String name, String capability, String date, String dateField) {
            this.name = name; this.capability = capability; this.date = date; this.dateField = dateField;
        }
        JSONObject args() throws Exception { return date == null ? new JSONObject() : new JSONObject().put("date", date); }
        JSONObject datedArgs(JSONObject data) throws Exception { return new JSONObject().put("date", data.getString(dateField)); }
        boolean isToday(JSONObject data) { return isToday(data, Instant.now()); }
        boolean isToday(JSONObject data, Instant now) {
            if (data == null || now == null || !(data.opt(dateField) instanceof String) || !(data.opt("timezone") instanceof String)) return false;
            String zone = (String)data.opt("timezone"); if (zone.length() > 64) return false;
            try { return data.opt(dateField).equals(now.atZone(ZoneId.of(zone)).toLocalDate().toString()); }
            catch (RuntimeException invalid) { return false; }
        }
        boolean accepts(JSONObject data) { return accepts(data, Instant.now()); }
        boolean accepts(JSONObject data, Instant now) {
            if (data == null || !(data.opt(dateField) instanceof String) || !validDate((String)data.opt(dateField))
                || date != null && !date.equals(data.opt(dateField)) || !(data.opt("timezone") instanceof String)
                || !(data.opt("salonName") instanceof String) || ((String)data.opt("salonName")).trim().isEmpty()
                || !data.has("setupMessage") || !data.isNull("setupMessage") && (!(data.opt("setupMessage") instanceof String) || !((String)data.opt("setupMessage")).trim().isEmpty())) return false;
            try { String zone = (String)data.opt("timezone"); if (zone.length() > 64) return false; ZoneId.of(zone); }
            catch (RuntimeException invalid) { return false; }
            if ((date == null || name.equals("portable.report")) && !isToday(data, now)) return false;
            if (name.equals("portable.ticket")) {
                JSONArray tickets = data.optJSONArray("tickets");
                if (tickets == null || data.optJSONArray("services") == null || data.optJSONArray("staff") == null
                    || !(data.opt("canEdit") instanceof Boolean) || !(data.opt("isBusinessDateLocked") instanceof Boolean)) return false;
                for (int i = 0; i < tickets.length(); i++) {
                    JSONObject ticket = tickets.optJSONObject(i);
                    if (ticket == null || !(ticket.opt("id") instanceof String) || !((String)ticket.opt("id")).matches("(?i)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
                        || !(ticket.opt("status") instanceof String) || !finite(ticket,"total") || !finite(ticket,"paid") || !finite(ticket,"remaining") || ticket.optJSONArray("items") == null) return false;
                    // A partial financial read must not replace a previously
                    // printable canonical closed receipt with missing sources.
                    if ("closed".equals(ticket.opt("status")) && (ticket.optJSONObject("financial_sources") == null
                        || ticket.optJSONObject("financial_sources").optJSONArray("recordedPayments") == null)) return false;
                }
                return true;
            }
            JSONObject totals = data.optJSONObject("totals");
            return name.equals("portable.report") && data.optJSONObject("closingInputs") != null && data.optJSONObject("lock") != null
                && totals != null && finite(totals,"expectedTotal") && finite(totals,"actualTotal") && finite(totals,"finalizedTicketCount");
        }
        JSONObject project(Cache cache, String scope) throws Exception { return project(cache, scope, Instant.now()); }

        // A clock argument keeps the default-date / midnight boundary testable.
        JSONObject project(Cache cache, String scope, Instant now) throws Exception {
            if (cache == null || now == null || scope == null || !scope.matches("(?i)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")) return null;
            if (date != null) {
                JSONObject data = matching(cache.read(name, new JSONObject().put("date", date), scope), scope, now);
                if (data != null) return data;
            }
            return matching(cache.read(name, new JSONObject(), scope), scope, now);
        }

        private JSONObject matching(JSONObject envelope, String scope, Instant now) {
            if (envelope == null || !(envelope.opt("schemaVersion") instanceof Number)
                || ((Number)envelope.opt("schemaVersion")).doubleValue() != 1
                || !(envelope.opt("status") instanceof Number) || ((Number)envelope.opt("status")).doubleValue() != 200
                || !scope.equals(envelope.opt("scope"))) return null;
            JSONObject data = envelope.optJSONObject("data");
            return accepts(data, now) ? data : null;
        }
    }

    static Request forResource(String name, JSONObject args) {
        if (args == null || !("portable.ticket".equals(name) || "portable.report".equals(name))) return null;
        java.util.Iterator<String> keys = args.keys();
        while (keys.hasNext()) if (!keys.next().equals("date")) return null;
        Object value = args.opt("date");
        if (args.has("date") && (!(value instanceof String) || !validDate((String)value))) return null;
        return name.equals("portable.ticket") ? new Request(name,"portable.today.view",(String)value,"date")
            : new Request(name,"portable.report.view",(String)value,"reportDate");
    }

    private static boolean finite(JSONObject value, String key) { return value.opt(key) instanceof Number && Double.isFinite(((Number)value.opt(key)).doubleValue()); }

    static Request parse(String rawPath, String rawQuery) {
        boolean tickets = "/api/pos/portable/tickets".equals(rawPath);
        boolean report = "/api/pos/portable/workspace".equals(rawPath);
        if (!tickets && !report || rawQuery != null && rawQuery.length() > 256) return null;
        Map<String,String> query = new HashMap<>();
        try {
            if (rawQuery != null && !rawQuery.isEmpty()) for (String pair : rawQuery.split("&", -1)) {
                String[] parts = pair.split("=", 2);
                if (parts.length != 2 || parts[0].isEmpty()) return null;
                String key = URLDecoder.decode(parts[0], "UTF-8"), value = URLDecoder.decode(parts[1], "UTF-8");
                if (!(key.equals("date") || report && key.equals("resource")) || query.put(key, value) != null) return null;
            }
        } catch (Exception invalidEncoding) { return null; }
        String date = query.get("date");
        if (date != null && !validDate(date) || report && !"report".equals(query.get("resource"))) return null;
        return tickets ? new Request("portable.ticket", "portable.today.view", date, "date")
            : new Request("portable.report", "portable.report.view", date, "reportDate");
    }

    private static boolean validDate(String date) {
        if (date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}")) return false;
        try { return LocalDate.parse(date).toString().equals(date); }
        catch (RuntimeException invalid) { return false; }
    }
}
