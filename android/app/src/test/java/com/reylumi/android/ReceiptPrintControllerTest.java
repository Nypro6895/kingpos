package com.reylumi.android;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ReceiptPrintControllerTest {
    private JSONObject job() throws Exception {
        return new JSONObject().put("version", 1).put("jobId", "8b2b3994-7dc8-44bb-acd4-c7768f059994")
            .put("kind", "test").put("title", "Test receipt").put("paper", "80mm").put("html", "<!doctype html><p>Test</p>");
    }
    @Test public void paperAndIdentityAreBounded() throws Exception {
        assertNull(ReceiptPrintController.validate(job()));
        assertEquals("invalid-paper", ReceiptPrintController.validate(job().put("paper", "unknown")));
        assertEquals("invalid-receipt", ReceiptPrintController.validate(job().put("kind", "receipt")));
        assertEquals("invalid-job", ReceiptPrintController.validate(job().put("jobId", "1-1-1-1-1")));
    }
    @Test public void provisionalCannotCarryAFinalReceiptIdentity() throws Exception {
        JSONObject provisional = job().put("kind", "provisional").put("operationId", "8b2b3994-7dc8-44bb-acd4-c7768f059995")
            .put("scope", "8b2b3994-7dc8-44bb-acd4-c7768f059996:8b2b3994-7dc8-44bb-acd4-c7768f059997");
        assertNull(ReceiptPrintController.validate(provisional));
        assertEquals("invalid-operation", ReceiptPrintController.validate(provisional.put("receiptId", "8b2b3994-7dc8-44bb-acd4-c7768f059998")));
    }
    @Test public void htmlBudgetUsesUtf8Bytes() throws Exception {
        assertEquals("invalid-document", ReceiptPrintController.validate(job().put("html", "界".repeat(350000))));
    }
}
