package com.reylumi.android;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PortableHttpReadProjectionTest {
    private static final String SCOPE = "00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002";
    private static final Instant NOW = Instant.parse("2026-11-19T01:00:00Z"); // Still Nov18 in salon.
    private static JSONObject data(boolean report, String date) throws Exception {
        JSONObject data = new JSONObject().put(report ? "reportDate" : "date", date).put("timezone", "America/Chicago")
            .put("salonName","Synthetic salon").put("setupMessage",JSONObject.NULL)
            .put("tickets", new JSONArray()).put("opaqueOriginal", new JSONObject().put("recordedTender", 59));
        if(report)return data.put("closingInputs",new JSONObject()).put("lock",new JSONObject())
            .put("totals",new JSONObject().put("expectedTotal",50).put("actualTotal",0).put("finalizedTicketCount",1));
        return data.put("canEdit",false).put("isBusinessDateLocked",false).put("services",new JSONArray()).put("staff",new JSONArray());
    }
    private static JSONObject envelope(JSONObject data) throws Exception {
        return new JSONObject().put("schemaVersion", 1).put("status", 200).put("scope", SCOPE).put("data", data);
    }

    @Test public void allowlistMatchesOnlyTheTwoKnownGetViews() {
        PortableHttpReadProjection.Request tickets = PortableHttpReadProjection.parse("/api/pos/portable/tickets", null);
        assertNotNull(tickets); assertEquals("portable.ticket", tickets.name); assertEquals("portable.today.view", tickets.capability);
        PortableHttpReadProjection.Request report = PortableHttpReadProjection.parse("/api/pos/portable/workspace", "resource=report&date=2026-11-18");
        assertNotNull(report); assertEquals("portable.report", report.name); assertEquals("portable.report.view", report.capability);
        for (String path : new String[]{null,"https://evil.test/api/pos/portable/tickets","/api/pos/portable/tickets/","/api/pos/portable/%74ickets","/api/pos/portable/tickets?date=2026-11-18","/api/app-local/command","/api/pos/portable/bookings"})
            assertNull(path, PortableHttpReadProjection.parse(path, null));
        assertNull(PortableHttpReadProjection.parse("/api/pos/portable/workspace", null));
    }

    @Test public void rejectsUnknownDuplicateAmbiguousAndInvalidFilters() {
        for (String query : new String[]{"date=2026-11-18&date=2026-11-18","date=2026-11-18&%64ate=2026-11-19","date=2026-02-29","date=2026-11-32","date=","date","date=%","date=2026-11-18&","scope=foreign","resource=report","date=2026-11-18&ids=x","date=2026-11-18#secret","date=2026-11-18;token=x"})
            assertNull(query, PortableHttpReadProjection.parse("/api/pos/portable/tickets", query));
        for (String query : new String[]{"resource=catalog","resource=settings","resource=report&resource=report","resource=report&ids=x","resource=report&date=2026-11-18&unknown=x"})
            assertNull(query, PortableHttpReadProjection.parse("/api/pos/portable/workspace", query));
    }

    @Test public void exactDateCacheWinsAndReturnsUnmodifiedCanonicalData() throws Exception {
        JSONObject original = data(false, "2026-11-17"), proof = envelope(original);
        List<String> args = new ArrayList<>();
        JSONObject result = PortableHttpReadProjection.parse("/api/pos/portable/tickets", "date=2026-11-17")
            .project((name, filters, scope) -> { assertEquals("portable.ticket", name); assertEquals(SCOPE, scope); args.add(filters.toString()); return proof; }, SCOPE, NOW);
        assertSame(original, result); assertEquals(1, args.size()); assertEquals("2026-11-17", new JSONObject(args.get(0)).getString("date"));
        assertEquals(59, result.getJSONObject("opaqueOriginal").getInt("recordedTender"));
    }

    @Test public void emptyArgsFallbackMustMatchTheExplicitRequestedDate() throws Exception {
        JSONObject original = data(false, "2026-11-18"); List<Integer> sizes = new ArrayList<>();
        PortableHttpReadProjection.Request request = PortableHttpReadProjection.parse("/api/pos/portable/tickets", "date=2026-11-18");
        assertSame(original, request.project((name, args, scope) -> { sizes.add(args.length()); return args.length() == 0 ? envelope(original) : null; }, SCOPE, NOW));
        assertEquals(java.util.Arrays.asList(1,0), sizes);
        assertNull(request.project((name,args,scope) -> envelope(data(false,"2026-11-17")), SCOPE, NOW));
        assertNull(request.project((name,args,scope) -> null, SCOPE, NOW));
    }

    @Test public void noDateUsesSalonTimezoneAndNeverReturnsYesterdaysDefault() throws Exception {
        PortableHttpReadProjection.Request request = PortableHttpReadProjection.parse("/api/pos/portable/tickets", null);
        assertNotNull(request.project((name,args,scope) -> envelope(data(false,"2026-11-18")), SCOPE, NOW));
        assertNull(request.project((name,args,scope) -> envelope(data(false,"2026-11-19")), SCOPE, NOW));
        assertNull(request.project((name,args,scope) -> envelope(data(false,"2026-11-17")), SCOPE, NOW));
        assertNull(request.project((name,args,scope) -> envelope(data(false,"2026-11-18").put("timezone","invalid/timezone")), SCOPE, NOW));
        assertNull(request.project((name,args,scope) -> envelope(data(false,"2026-11-18").put("timezone",JSONObject.NULL)), SCOPE, NOW));
    }

    @Test public void reportUsesItsRealReportDateFieldAndRetainsTodayOnlyRule() throws Exception {
        JSONObject report = data(true,"2026-11-18");
        PortableHttpReadProjection.Request request = PortableHttpReadProjection.parse("/api/pos/portable/workspace", "date=2026-11-18&resource=report");
        assertSame(report, request.project((name,args,scope) -> { assertEquals("portable.report",name); return envelope(report); }, SCOPE, NOW));
        assertNull(request.project((name,args,scope) -> envelope(data(false,"2026-11-18")), SCOPE, NOW));
        assertNull(PortableHttpReadProjection.parse("/api/pos/portable/workspace","resource=report&date=2026-11-17")
            .project((name,args,scope) -> envelope(data(true,"2026-11-17")), SCOPE, NOW));
        assertNotNull(PortableHttpReadProjection.parse("/api/pos/portable/workspace","resource=report")
            .project((name,args,scope) -> envelope(report), SCOPE, NOW));
    }

    @Test public void malformedOrForeignCacheEnvelopesDoNotProduceAView() throws Exception {
        PortableHttpReadProjection.Request request = PortableHttpReadProjection.parse("/api/pos/portable/tickets","date=2026-11-18");
        for (JSONObject invalid : new JSONObject[]{new JSONObject(), envelope(data(false,"2026-11-18")).put("scope","foreign"),
            envelope(data(false,"2026-11-18")).put("status",304), envelope(data(false,"2026-11-18")).put("status",403),
            envelope(data(false,"2026-11-18")).put("schemaVersion","1"), envelope(data(false,"2026-11-18")).put("data",new JSONArray()),
            envelope(data(false,"2026-11-18")).put("data",JSONObject.NULL)})
            assertNull(request.project((name,args,scope) -> invalid, SCOPE, NOW));
        assertNull(request.project((name,args,scope) -> { fail("Invalid scope must not touch native cache"); return null; }, "foreign", NOW));
    }

    @Test public void cacheArgsAndDtoGuardsRejectPlaceholdersAndPartialFinancialRows() throws Exception {
        PortableHttpReadProjection.Request tickets=PortableHttpReadProjection.forResource("portable.ticket",new JSONObject().put("date","2026-11-18"));
        assertNotNull(tickets);assertEquals(1,tickets.args().length());assertEquals("2026-11-18",tickets.args().getString("date"));
        assertTrue(tickets.accepts(data(false,"2026-11-18"),NOW));assertTrue(tickets.isToday(data(false,"2026-11-18"),NOW));
        assertFalse(tickets.accepts(data(false,"2026-11-18").put("setupMessage","Temporarily unavailable"),NOW));
        assertFalse(tickets.accepts(data(false,"2026-11-18").put("tickets",new JSONArray().put(new JSONObject().put("id","partial"))),NOW));
        assertFalse(tickets.accepts(data(false,"2026-11-18").put("canEdit",0),NOW));
        assertFalse(tickets.accepts(data(false,"2026-11-18").put("timezone","invalid/zone"),NOW));
        JSONObject report=data(true,"2026-11-18");report.getJSONObject("totals").remove("expectedTotal");
        assertFalse(PortableHttpReadProjection.forResource("portable.report",new JSONObject()).accepts(report,NOW));
        for(String name:new String[]{null,"portable.workspace","portable.http.tickets","other"})assertNull(PortableHttpReadProjection.forResource(name,new JSONObject()));
        assertNull(PortableHttpReadProjection.forResource("portable.ticket",new JSONObject().put("date","2026-02-29")));
        assertNull(PortableHttpReadProjection.forResource("portable.ticket",new JSONObject().put("scope","foreign")));
    }

    @Test public void historicalTicketCanBeCachedExplicitlyButNeverAliasesToday() throws Exception {
        PortableHttpReadProjection.Request request=PortableHttpReadProjection.forResource("portable.ticket",new JSONObject().put("date","2026-11-17"));
        JSONObject old=data(false,"2026-11-17");assertTrue(request.accepts(old,NOW));assertFalse(request.isToday(old,NOW));
        assertEquals(0,PortableHttpReadProjection.forResource("portable.ticket",new JSONObject()).args().length());
    }
}
