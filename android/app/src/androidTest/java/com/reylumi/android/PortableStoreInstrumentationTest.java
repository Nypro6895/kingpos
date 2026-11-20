package com.reylumi.android;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PortableStoreInstrumentationTest {
    private static final String SCOPE="00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003";
    private static final String OTHER="00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000004";
    private final String origin=NavigationPolicy.appOrigin();
    private File directory;
    private PortableStore store;
    private final List<PortableDeviceBridge> bridges=new ArrayList<>();
    private String draft(){return "kingpos:portable-draft:v1:"+SCOPE+":native";}
    @Before public void setup()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        directory=new File(context.getNoBackupFilesDir(),"portable-native-fixture-"+UUID.randomUUID());store=new PortableStore(directory,origin);
        assertTrue("Fixture must never use the actual app's Keystore alias",store.keyAlias().startsWith("com.reylumi.portable-vault.v1."+PortableStore.digest(origin)+".fixture."));
    }
    @After public void cleanup()throws Exception{
        for(PortableDeviceBridge bridge:bridges)bridge.dispose();
        if(!directory.getName().startsWith("portable-native-fixture-")||!store.keyAlias().contains(".fixture."))throw new AssertionError("Unsafe fixture cleanup");
        store.close();KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(store.keyAlias());delete(directory);
    }
    private static void delete(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)delete(child);if(file.exists()&&!file.delete())throw new AssertionError("Fixture cleanup failed");}
    private JSONObject operation()throws Exception{
        JSONObject snapshot=new JSONObject().put("version",1).put("completion","submitted-on-device").put("paymentState","awaiting-server-validation").put("capturedAt",java.time.Instant.now().toString()).put("customerName","Synthetic encrypted customer")
            .put("lines",new JSONArray().put(new JSONObject().put("service_name","Synthetic service").put("assigned_staff","Synthetic staff").put("line_total",127.5)))
            .put("totals",new JSONObject().put("subtotal",127.5).put("discount",0).put("tax",0).put("tip",0).put("grand_total",127.5));
        return new JSONObject().put("id",UUID.randomUUID().toString()).put("scope",SCOPE).put("kind","receipt").put("state","pending").put("occurredAt","2026-11-18T12:00:00.000Z").put("payload",new JSONObject().put("localDraftKey",draft()).put("total",127.5).put("customer","Synthetic encrypted customer").put("printSnapshot",snapshot));
    }
    interface Work{void run()throws Exception;}
    private static void refuses(Work work)throws Exception{try{work.run();fail("Expected native refusal");}catch(AssertionError error){throw error;}catch(Exception expected){}}

    @Test public void realKeystoreSynchronousDraftSurvivesReopenAndDiskContainsNoPrivateValue()throws Exception{
        String body="{\"savedAt\":1234,\"customer\":\"Synthetic encrypted customer\",\"amount\":\"127.50\"}";
        store.set(draft(),body,SCOPE);store.close();PortableStore reopened=new PortableStore(directory,origin);
        assertEquals(body,reopened.get(draft(),SCOPE));reopened.close();
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);assertNull(keys.getKey(store.keyAlias(),null).getEncoded());
        File[] files=store.databaseFile().getParentFile().listFiles();assertNotNull(files);assertTrue(files.length>0);
        for(File file:files)if(file.isFile()){String raw=new String(Files.readAllBytes(file.toPath()),StandardCharsets.ISO_8859_1);assertFalse(raw.contains("Synthetic encrypted customer"));assertFalse(raw.contains("127.50"));}
    }
    @Test public void acknowledgedLargeDraftAndNativeAssetSurviveColdReadBeyondCursorWindow()throws Exception{
        char[] text=new char[2_600_000];java.util.Arrays.fill(text,'x');String payload=new String(text);
        String draftValue=new JSONObject().put("syntheticContent",payload).toString();store.set(draft(),draftValue,SCOPE);
        store.cachePut("fixture-large-asset",new JSONObject().put("body",payload).put("sha256","synthetic-fixture"));store.close();
        PortableStore reopened=new PortableStore(directory,origin);try{assertTrue("An acknowledged2.6MB draft must be readable after reopen",draftValue.equals(reopened.get(draft(),SCOPE)));assertEquals(payload.length(),reopened.cacheGet("fixture-large-asset").getString("body").length());}finally{reopened.close();}
    }
    @Test public void displayPruningCannotTouchFinancialRowsAdmissionOrUnknownCacheMetadata()throws Exception{
        char[] zeros=new char[64],ones=new char[64];java.util.Arrays.fill(zeros,'0');java.util.Arrays.fill(ones,'1');String oldBuild=new String(zeros),build=new String(ones);
        String oldAsset="display:v1:"+oldBuild+"|/_next/static/old.js",asset="display:v1:"+build+"|/_next/static/new.js",oldHtml="display:v1:"+OTHER+"|/pos/portable",html="display:v1:"+SCOPE+"|/pos/portable",unknown="display:v1:other-metadata";
        for(String key:new String[]{oldAsset,asset,oldHtml,html,unknown,"display:v1:prepared","context|/pos/portable","portable-transport:v1"})store.cachePut(key,new JSONObject().put("fixture",true));
        store.set(draft(),"{}",SCOPE);store.save(operation(),SCOPE,false,null);store.cachePruneDisplay(build,SCOPE);
        assertNull(store.cacheGet(oldAsset));assertNull(store.cacheGet(oldHtml));for(String key:new String[]{asset,html,unknown,"display:v1:prepared","context|/pos/portable","portable-transport:v1"})assertNotNull(store.cacheGet(key));assertEquals("{}",store.get(draft(),SCOPE));assertEquals(1,store.list(SCOPE).length());assertTrue(store.checkpoint(SCOPE,draft())>0);
    }
    @Test public void receiptCheckpointRetryAndImmutableTerminalStatesUseRealSQLiteTransaction()throws Exception{
        long future=System.currentTimeMillis()+3600000;store.set(draft(),new JSONObject().put("savedAt",future).toString(),SCOPE);
        JSONObject op=operation(),saved=store.save(op,SCOPE,false,null);double checkpoint=store.checkpoint(SCOPE,draft());assertTrue(checkpoint>=future);
        JSONObject repeat=store.save(new JSONObject(op.toString()).put("id",op.getString("id").toUpperCase(java.util.Locale.ROOT)),SCOPE,false,null);
        assertEquals(saved.getLong("sequence"),repeat.getLong("sequence"));assertEquals(1,store.list(SCOPE).length());assertEquals(checkpoint,store.checkpoint(SCOPE,draft()),0);
        refuses(()->store.save(new JSONObject(op.toString()).put("payload",new JSONObject().put("total",1)),SCOPE,false,null));
        refuses(()->store.save(new JSONObject(op.toString()).put("state","cancelled"),SCOPE,false,null));
        store.save(new JSONObject(op.toString()).put("state","synced"),SCOPE,false,null);refuses(()->store.save(op,SCOPE,false,null));assertEquals(0,store.pendingCount(SCOPE));
    }
    @Test public void failedNativeCommitLeavesNeitherOperationNorCheckpointAndRetainsDraft()throws Exception{
        store.set(draft(),"{\"savedAt\":1}",SCOPE);
        SQLiteDatabase fixture=SQLiteDatabase.openDatabase(store.databaseFile().getPath(),null,SQLiteDatabase.OPEN_READWRITE);
        fixture.execSQL("CREATE TRIGGER fixture_refusal BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT,'fixture disk refusal'); END");
        refuses(()->store.save(operation(),SCOPE,false,null));assertEquals(0,store.list(SCOPE).length());assertEquals(0,store.checkpoint(SCOPE,draft()),0);assertNotNull(store.get(draft(),SCOPE));fixture.close();
    }
    @Test public void ciphertextSubstitutionAndLostKeystoreKeyCannotCreateAReplacementVault()throws Exception{
        String foreign="kingpos:parked-tickets:v1:"+OTHER;store.set(draft(),"{}",SCOPE);store.set(foreign,"[]",OTHER);
        SQLiteDatabase fixture=SQLiteDatabase.openDatabase(store.databaseFile().getPath(),null,SQLiteDatabase.OPEN_READWRITE);
        fixture.execSQL("UPDATE saved SET body=(SELECT body FROM saved WHERE key=?) WHERE key=?",new Object[]{foreign,draft()});fixture.close();
        refuses(()->store.get(draft(),SCOPE));assertEquals("[]",store.get(foreign,OTHER));store.close();
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(store.keyAlias());refuses(()->store.get(foreign,OTHER));assertFalse(keys.containsAlias(store.keyAlias()));
    }
    @Test public void namespacesCredentialsStrictJsonDepthAndImportNeverDowngradeNativeProgress()throws Exception{
        store.set(draft(),"{}",SCOPE);refuses(()->store.get(draft(),OTHER));refuses(()->store.remove(draft(),OTHER));refuses(()->store.set(draft(),"{'invalid':1}",SCOPE));
        for(String field:new String[]{"password","passcode","pin","access_token","cardNumber","cvv"})refuses(()->store.set(draft(),new JSONObject().put(field,"synthetic").toString(),SCOPE));
        String deep="{}";for(int i=0;i<66;i++)deep="["+deep+"]";final String nested=deep;refuses(()->PortableStore.validateWireJson(nested));
        JSONObject op=operation();store.save(op,SCOPE,true,1d);store.save(new JSONObject(op.toString()).put("state","synced"),SCOPE,false,null);
        JSONObject retained=store.save(op,SCOPE,true,1d);assertEquals("synced",retained.getString("state"));assertEquals(1,store.checkpoint(SCOPE,draft()),0);
    }

    private final class Server implements PortableTransport.Http {
        final AtomicReference<String> cookies=new AtomicReference<>("kingpos-portable-pos-key-id="+SCOPE.split(":")[1]+"; kingpos-portable-pos-session=synthetic-session; kingpos-workspace-device=synthetic-device");
        boolean down,changeCookie,deny,commands=true;String path="/pos/portable";
        JSONArray capabilities=new JSONArray().put("portable.pos.use").put("portable.book.view");
        JSONObject ticketData,reportData;int ticketReads,reportReads;
        @Override public PortableTransport.Response get(String relative)throws Exception{
            if(down)throw new java.io.IOException("Synthetic network unavailable");if(deny)return new PortableTransport.Response(403,new JSONObject());
            if(relative.startsWith("/api/app-local/context")){
                String raw=java.net.URI.create(origin+relative).getRawQuery(),generation="";
                for(String pair:raw.split("&")){String[] p=pair.split("=",2);if(p[0].equals("generation"))generation=java.net.URLDecoder.decode(p[1],"UTF-8");if(p[0].equals("path"))path=java.net.URLDecoder.decode(p[1],"UTF-8");}
                long now=System.currentTimeMillis();String[] parts=SCOPE.split(":");
                JSONObject grant=new JSONObject().put("version",1).put("kind","portable").put("scope",SCOPE).put("scopes",new JSONArray().put(SCOPE)).put("generation",generation).put("grantRevision","fixture-revision").put("issuedAt",now).put("expiresAt",now+3600000).put("path",path).put("salonId",parts[0]).put("workspaceId",parts[1]).put("viewerId",JSONObject.NULL).put("localCommands",commands);
                JSONObject context=new JSONObject().put("scope",SCOPE).put("salonId",parts[0]).put("workspaceId",parts[1]).put("viewerId",JSONObject.NULL).put("permissionRevision","fixture-revision").put("authenticated",false);
                JSONObject descriptor=new JSONObject().put("scope",SCOPE).put("salonId",parts[0]).put("keyId",parts[1]).put("capabilities",new JSONArray(capabilities.toString())).put("offlineEnabled",commands);
                JSONObject body=new JSONObject().put("schemaVersion",1).put("grantStatus",200).put("context",context).put("grant",grant).put("portable",descriptor);
                if(changeCookie)cookies.set(cookies.get().replace("synthetic-session","different-synthetic-session"));return new PortableTransport.Response(200,body);
            }
            JSONObject data=new JSONObject().put("salonId",SCOPE.split(":")[0]);
            if(relative.contains("name=portable.ticket")){ticketReads++;if(ticketData!=null)data=ticketData;}
            if(relative.contains("name=portable.report")){reportReads++;if(reportData!=null)data=reportData;}
            return new PortableTransport.Response(200,new JSONObject().put("schemaVersion",1).put("status",200).put("scope",SCOPE).put("data",data));
        }
    }
    private PortableTransport transport(Server server)throws Exception{return new PortableTransport(store,origin,server.cookies::get,server);}
    private PortableDeviceBridge bridge(PortableTransport transport){PortableDeviceBridge bridge=new PortableDeviceBridge(store,transport,origin);bridges.add(bridge);return bridge;}
    private JSONObject body(PortableDeviceBridge bridge,String action)throws Exception{return new JSONObject().put("version",1).put("nonce",bridge.nonce()).put("documentGeneration",bridge.documentGeneration()).put("path","/pos/portable").put("action",action).put("scope",SCOPE);}
    @Test public void nativeAdmissionColdRestoreCookieBindingExplicitLockAndMissingShellRemainClosed()throws Exception{
        Server server=new Server();PortableTransport transport=transport(server);PortableDeviceBridge bridge=bridge(transport);
        JSONObject prepared=(JSONObject)bridge.request(body(bridge,"storage.prepare"),origin+"/pos/portable",true,bridge.documentGeneration());assertTrue(prepared.getBoolean("ok"));assertFalse(prepared.getBoolean("offlineReady"));
        transport.warm(transport.admitted());bridge.setOfflineShellReady(()->true);assertTrue(((JSONObject)bridge.request(body(bridge,"storage.status"),origin+"/pos/portable",true,bridge.documentGeneration())).getBoolean("offlineReady"));
        server.down=true;PortableTransport cold=transport(server);assertNotNull(cold.restoreDocumentAdmission("/pos/portable"));
        server.cookies.set(server.cookies.get().replace("synthetic-session","rotated"));assertNull(cold.restoreDocumentAdmission("/pos/portable"));
        server.cookies.set(server.cookies.get().replace("rotated","synthetic-session"));bridge.lock();assertNull(transport(server).restoreDocumentAdmission("/pos/portable"));assertNotNull(store.databaseFile());
    }
    @Test public void oldHttpResponseCannotBorrowChangedCookieAndCanonicalQueryKeepsBookCapability()throws Exception{
        Server server=new Server();server.changeCookie=true;PortableTransport transport=transport(server);refuses(()->transport.prepare(SCOPE,"/pos/portable",false));assertNull(transport.restoreDocumentAdmission("/pos/portable"));
        server.changeCookie=false;PortableTransport.Admission book=transport.prepare(SCOPE,"/pos/portable/book?date=2026-11-19",false);assertEquals("/pos/portable/book?date=2026-11-19",book.path);assertNotNull(transport.restoreDocumentAdmission(book.path));
        assertNull(PortableTransport.canonicalPath("/pos/portable?token=synthetic"));assertEquals("portable.book.view",PortableTransport.pathCapability(book.path));
    }
    @Test public void writerDocumentFencePendingPrintAndUntrustedFrameStayIndependentOfJobData()throws Exception{
        Server server=new Server();PortableTransport transport=transport(server);PortableDeviceBridge bridge=bridge(transport);
        assertTrue(((JSONObject)bridge.request(body(bridge,"storage.prepare"),origin+"/pos/portable",false,bridge.documentGeneration())).has("__portableError"));
        bridge.request(body(bridge,"storage.prepare"),origin+"/pos/portable",true,bridge.documentGeneration());
        transport.warm(transport.admitted());bridge.setOfflineShellReady(()->true);
        JSONObject acquire=(JSONObject)bridge.request(body(bridge,"writer.acquire").put("key",draft()),origin+"/pos/portable",true,bridge.documentGeneration());String token=acquire.getString("token");
        JSONObject prompt=body(bridge,"storage.set").put("key",draft()).put("value","{\"savedAt\":1234}").put("writerToken",token);assertTrue(new JSONObject(bridge.prompt("__reylumiPortableDevice:"+prompt,origin+"/pos/portable",origin+"/pos/portable")).getBoolean("ok"));
        JSONObject operation=operation();assertTrue(((JSONObject)bridge.request(body(bridge,"operations.save").put("operation",operation).put("writerToken",token),origin+"/pos/portable",true,bridge.documentGeneration())).getBoolean("ok"));assertNull(bridge.validateProvisional(SCOPE,operation.getString("id")));assertNotNull(bridge.validateProvisional(OTHER,operation.getString("id")));
        JSONObject stale=body(bridge,"operations.list");long old=bridge.documentGeneration();bridge.documentWillNavigate();assertTrue(((JSONObject)bridge.request(stale,origin+"/pos/portable",true,old)).has("__portableError"));assertNotNull(bridge.validateProvisional(SCOPE,operation.getString("id")));assertEquals(1,store.list(SCOPE).length());
    }
    @Test public void provisionalGateRejectsAttentionRejectedMissingCaptureAndInvalidCheckpoint()throws Exception{
        Server server=new Server();PortableTransport transport=transport(server);PortableDeviceBridge bridge=bridge(transport);bridge.request(body(bridge,"storage.prepare"),origin+"/pos/portable",true,bridge.documentGeneration());transport.warm(transport.admitted());bridge.setOfflineShellReady(()->true);
        JSONObject pending=operation();store.save(pending,SCOPE,false,null);assertNull(bridge.validateProvisional(SCOPE,pending.getString("id")));
        store.save(new JSONObject(pending.toString()).put("state","attention"),SCOPE,false,null);assertNotNull(bridge.validateProvisional(SCOPE,pending.getString("id")));
        store.save(new JSONObject(pending.toString()).put("rejected",true),SCOPE,false,null);assertNotNull(bridge.validateProvisional(SCOPE,pending.getString("id")));
        JSONObject missing=operation();missing.getJSONObject("payload").remove("printSnapshot");store.save(missing,SCOPE,false,null);assertNotNull(bridge.validateProvisional(SCOPE,missing.getString("id")));
        JSONObject invalid=operation();invalid.getJSONObject("payload").getJSONObject("printSnapshot").put("capturedAt","not-a-date");store.save(invalid,SCOPE,false,null);assertNotNull(bridge.validateProvisional(SCOPE,invalid.getString("id")));
        JSONObject paid=operation();paid.getJSONObject("payload").getJSONObject("printSnapshot").put("paymentState","paid");store.save(paid,SCOPE,false,null);assertNotNull(bridge.validateProvisional(SCOPE,paid.getString("id")));
        JSONObject tooEarly=operation();tooEarly.getJSONObject("payload").put("localDraftKey",draft()+":too-early");store.save(tooEarly,SCOPE,true,1d);assertNotNull(bridge.validateProvisional(SCOPE,tooEarly.getString("id")));
        long future=System.currentTimeMillis()+3600000;String futureKey=draft()+":too-late";store.set(futureKey,new JSONObject().put("savedAt",future).toString(),SCOPE);JSONObject tooLate=operation();tooLate.getJSONObject("payload").put("localDraftKey",futureKey);store.save(tooLate,SCOPE,false,null);assertNotNull(bridge.validateProvisional(SCOPE,tooLate.getString("id")));
        bridge.setOfflineShellReady(()->false);assertNotNull(bridge.validateProvisional(SCOPE,pending.getString("id")));
    }
    @Test public void siblingWarmAndLateNetworkRepliesNeverReplaceOrRevokeANewerAdmission()throws Exception{
        Server server=new Server();java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean delay=new java.util.concurrent.atomic.AtomicBoolean(true);
        PortableTransport.Http delayed=relative->{PortableTransport.Response reply=server.get(relative);if(relative.startsWith("/api/app-local/context")&&delay.compareAndSet(true,false)){entered.countDown();if(!release.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("Fixture timeout");}return reply;};
        PortableTransport transport=new PortableTransport(store,origin,server.cookies::get,delayed);
        java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
        try{
            java.util.concurrent.Future<PortableTransport.Admission> old=worker.submit(()->transport.prepare(SCOPE,"/pos/portable",false));assertTrue(entered.await(5,java.util.concurrent.TimeUnit.SECONDS));
            PortableTransport.Admission newest=transport.prepare(SCOPE,"/pos/portable/book",false);release.countDown();
            try{old.get(5,java.util.concurrent.TimeUnit.SECONDS);fail("Old context was accepted");}catch(java.util.concurrent.ExecutionException expected){assertTrue(expected.getCause()instanceof PortableTransport.Denied);}
            assertSame(newest,transport.admitted());assertFalse(transport.requiresOnline());
            PortableTransport.Admission sibling=transport.warmDocumentAdmission(SCOPE,"/pos/portable");assertEquals("/pos/portable",sibling.path);assertSame(newest,transport.admitted());assertEquals(newest.expiresAt,transport.admitted().expiresAt);
        }finally{release.countDown();worker.shutdownNow();}
        java.util.concurrent.CountDownLatch readEntered=new java.util.concurrent.CountDownLatch(1),readRelease=new java.util.concurrent.CountDownLatch(1);java.util.concurrent.atomic.AtomicBoolean delayedRead=new java.util.concurrent.atomic.AtomicBoolean(false);
        PortableTransport.Http reads=relative->{if(relative.startsWith("/api/app-local/read")&&delayedRead.compareAndSet(true,false)){readEntered.countDown();if(!readRelease.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("Fixture timeout");return new PortableTransport.Response(403,new JSONObject());}return server.get(relative);};
        PortableTransport reader=new PortableTransport(store,origin,server.cookies::get,reads);reader.prepare(SCOPE,"/pos/portable",false);delayedRead.set(true);
        java.util.concurrent.ExecutorService readWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
        try{
            java.util.concurrent.Future<JSONObject> oldRead=readWorker.submit(()->reader.read("portable.workspace",new JSONObject(),SCOPE));assertTrue(readEntered.await(5,java.util.concurrent.TimeUnit.SECONDS));
            PortableTransport.Admission newest=reader.prepare(SCOPE,"/pos/portable/book",false);readRelease.countDown();
            try{oldRead.get(5,java.util.concurrent.TimeUnit.SECONDS);fail("Denied old read succeeded");}catch(java.util.concurrent.ExecutionException expected){assertTrue(expected.getCause()instanceof PortableTransport.Denied);}
            assertSame(newest,reader.admitted());assertFalse(reader.requiresOnline());server.deny=true;refuses(()->reader.read("portable.workspace",new JSONObject(),SCOPE));assertNull(reader.admitted());assertTrue(reader.requiresOnline());
        }finally{readRelease.countDown();readWorker.shutdownNow();}
    }
    @Test public void displayHttpDenialGuardCannotLockANewerAdmissionOrChangedCookie()throws Exception{
        Server server=new Server();PortableTransport transport=transport(server);transport.prepare(SCOPE,"/pos/portable",false);
        java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
        PortableTransport.Http denied=relative->{entered.countDown();if(!release.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("Fixture timeout");return new PortableTransport.Response(403,new JSONObject());};
        PortableTransport.ReadGuard old=transport.captureReadGuard();assertNotNull(old);
        java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
        try{
            java.util.concurrent.Future<Boolean> revoked=worker.submit(()->{PortableTransport.Response response=denied.get("/pos/portable");return response.status==403&&transport.rejectRead(old);});
            assertTrue(entered.await(5,java.util.concurrent.TimeUnit.SECONDS));PortableTransport.Admission newer=transport.prepare(SCOPE,"/pos/portable/book",false);release.countDown();
            assertFalse("Late old HTTP denial must not revoke new prepare flight",revoked.get(5,java.util.concurrent.TimeUnit.SECONDS));assertSame(newer,transport.admitted());assertFalse(transport.requiresOnline());
        }finally{release.countDown();worker.shutdownNow();}
        PortableTransport.ReadGuard changedCookie=transport.captureReadGuard();String original=server.cookies.get();server.cookies.set(original.replace("synthetic-session","different-session"));
        assertFalse(transport.rejectRead(changedCookie));assertFalse(transport.requiresOnline());server.cookies.set(original);assertNotNull(transport.admitted());
        PortableTransport.ReadGuard current=transport.captureReadGuard();assertTrue(transport.rejectRead(current));assertNull(transport.admitted());assertTrue(transport.requiresOnline());assertFalse("An already consumed epoch cannot revoke again",transport.rejectRead(current));assertFalse(transport.rejectRead(null));
        // Main-document fetching starts before cold JS storage.prepare. Matching
        // cookie proof still permits a real denial to persist the local lock.
        transport.prepare(SCOPE,"/pos/portable",true);PortableTransport cold=transport(server);assertNull(cold.admitted());PortableTransport.ReadGuard coldGuard=cold.captureReadGuard();assertNotNull(coldGuard);assertTrue(cold.rejectRead(coldGuard));assertNull(cold.restoreDocumentAdmission("/pos/portable"));
        server.cookies.set("");assertNull(cold.captureReadGuard());
    }

    private JSONObject ticketData(double total)throws Exception{
        String date=java.time.Instant.now().atZone(java.time.ZoneId.of("America/Chicago")).toLocalDate().toString();
        JSONArray tickets=new JSONArray();if(total!=0)tickets.put(new JSONObject().put("id","50000000-0000-4000-8000-000000000001").put("status","closed")
            .put("total",total).put("paid",total).put("remaining",0).put("items",new JSONArray())
            .put("financial_sources",new JSONObject().put("recordedPayments",new JSONArray().put(new JSONObject().put("amount",total).put("paymentMethod","other")))));
        return new JSONObject().put("date",date).put("timezone","America/Chicago").put("salonName","Synthetic native fixture").put("setupMessage",JSONObject.NULL)
            .put("canEdit",false).put("isBusinessDateLocked",false).put("services",new JSONArray()).put("staff",new JSONArray()).put("tickets",tickets);
    }
    private JSONObject reportData(double total)throws Exception{
        return new JSONObject().put("reportDate",ticketData(0).getString("date")).put("timezone","America/Chicago").put("salonName","Synthetic native fixture")
            .put("setupMessage",JSONObject.NULL).put("closingScope",SCOPE).put("closingInputs",new JSONObject()).put("lock",new JSONObject())
            .put("totals",new JSONObject().put("expectedTotal",total).put("actualTotal",0).put("finalizedTicketCount",total==0?0:1));
    }
    private Server receiptServer()throws Exception{
        Server server=new Server();server.capabilities.put("portable.today.view").put("portable.report.view");server.ticketData=ticketData(0);server.reportData=reportData(0);return server;
    }
    @Test public void trustedHttpCanonicalDtoRefreshesSealedCachesWithoutChangingLease()throws Exception{
        Server server=receiptServer();PortableTransport transport=transport(server);PortableTransport.Admission admission=transport.prepare(SCOPE,"/pos/portable",false);transport.warm(admission);
        assertEquals(0,transport.cachedResource("portable.ticket",new JSONObject(),SCOPE).getJSONObject("data").getJSONArray("tickets").length());
        long expiry=admission.expiresAt;JSONObject dto=ticketData(50);String original=dto.toString();
        PortableHttpReadProjection.Request request=PortableHttpReadProjection.forResource("portable.ticket",new JSONObject().put("date",dto.getString("date")));
        assertTrue(transport.cacheHttpRead(admission,transport.captureReadGuard(),request,dto));assertEquals(original,dto.toString());assertSame(admission,transport.admitted());assertEquals(expiry,transport.admitted().expiresAt);
        assertEquals(50,transport.cachedResource("portable.ticket",request.args(),SCOPE).getJSONObject("data").getJSONArray("tickets").getJSONObject(0).getDouble("total"),0);
        assertEquals(1,transport.cachedResource("portable.ticket",new JSONObject(),SCOPE).getJSONObject("data").getJSONArray("tickets").length());
        PortableTransport reopened=transport(server);assertNotNull(reopened.restoreDocumentAdmission("/pos/portable"));assertEquals(50,reopened.cachedResource("portable.ticket",new JSONObject(),SCOPE).getJSONObject("data").getJSONArray("tickets").getJSONObject(0).getDouble("paid"),0);
        JSONObject historical=ticketData(75).put("date",java.time.LocalDate.parse(dto.getString("date")).minusDays(1).toString());
        PortableHttpReadProjection.Request old=PortableHttpReadProjection.forResource("portable.ticket",new JSONObject().put("date",historical.getString("date")));
        assertTrue(transport.cacheHttpRead(admission,transport.captureReadGuard(),old,historical));assertEquals(50,transport.cachedResource("portable.ticket",new JSONObject(),SCOPE).getJSONObject("data").getJSONArray("tickets").getJSONObject(0).getDouble("total"),0);
    }
    @Test public void lateHttp200AndBadDtoCannotOverwriteANewerCanonicalCache()throws Exception{
        Server server=receiptServer();PortableTransport transport=transport(server);PortableTransport.Admission old=transport.prepare(SCOPE,"/pos/portable",false);PortableTransport.ReadGuard oldGuard=transport.captureReadGuard();
        PortableHttpReadProjection.Request request=PortableHttpReadProjection.forResource("portable.ticket",new JSONObject());
        PortableTransport.Admission newer=transport.prepare(SCOPE,"/pos/portable/book",false);assertTrue(transport.cacheHttpRead(newer,transport.captureReadGuard(),request,ticketData(50)));
        assertFalse(transport.cacheHttpRead(old,oldGuard,request,ticketData(0)));
        PortableTransport.ReadGuard cookieGuard=transport.captureReadGuard();String cookie=server.cookies.get();server.cookies.set(cookie.replace("synthetic-session","changed-session"));assertFalse(transport.cacheHttpRead(newer,cookieGuard,request,ticketData(0)));server.cookies.set(cookie);
        assertFalse(transport.cacheHttpRead(newer,transport.captureReadGuard(),request,ticketData(0).put("setupMessage","Temporarily unavailable")));
        assertFalse(transport.cacheHttpRead(newer,transport.captureReadGuard(),request,new JSONObject().put("date",ticketData(0).getString("date"))));
        assertFalse(transport.cacheHttpRead(newer,transport.captureReadGuard(),request,ticketData(0).put("salonId",OTHER.split(":")[1])));
        assertEquals(50,transport.cachedResource("portable.ticket",new JSONObject(),SCOPE).getJSONObject("data").getJSONArray("tickets").getJSONObject(0).getDouble("total"),0);
        // Same admitted object remains visible while a newer prepare is in
        // flight; the flight guard must still reject the older HTTP200.
        java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
        PortableTransport.Http delayed=relative->{if(relative.startsWith("/api/app-local/context")){entered.countDown();if(!release.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("Fixture timeout");}return server.get(relative);};
        PortableTransport racing=new PortableTransport(store,origin,server.cookies::get,delayed);PortableTransport.Admission restored=racing.restoreDocumentAdmission("/pos/portable/book");assertNotNull(restored);PortableTransport.ReadGuard before=racing.captureReadGuard();
        java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
        try{java.util.concurrent.Future<?> future=worker.submit(()->{try{racing.prepare(SCOPE,"/pos/portable",false);}catch(Exception error){throw new RuntimeException(error);}});assertTrue(entered.await(5,java.util.concurrent.TimeUnit.SECONDS));assertSame(restored,racing.admitted());assertFalse(racing.cacheHttpRead(restored,before,request,ticketData(0)));release.countDown();future.get(5,java.util.concurrent.TimeUnit.SECONDS);}finally{release.countDown();worker.shutdownNow();}
    }
    @Test public void receiptAckRefreshFetchesFreshDtosAndPreservesGoodDataOnError()throws Exception{
        Server server=receiptServer();PortableTransport transport=transport(server);PortableDeviceBridge bridge=bridge(transport);
        bridge.request(body(bridge,"storage.prepare"),origin+"/pos/portable",true,bridge.documentGeneration());PortableTransport.Admission admission=transport.admitted();transport.warm(admission);
        JSONObject claim=(JSONObject)bridge.request(body(bridge,"writer.acquire").put("key",draft()),origin+"/pos/portable",true,bridge.documentGeneration());String token=claim.getString("token");long expiry=admission.expiresAt,generation=bridge.documentGeneration();
        int before=server.ticketReads;server.ticketData=ticketData(50);server.reportData=reportData(50);transport.refreshReceiptReads(admission);
        assertTrue(server.ticketReads>before);assertEquals(50,transport.cachedResource("portable.report",new JSONObject(),SCOPE).getJSONObject("data").getJSONObject("totals").getDouble("expectedTotal"),0);
        assertEquals(50,transport.cachedResource("portable.ticket",new JSONObject(),SCOPE).getJSONObject("data").getJSONArray("tickets").getJSONObject(0).getDouble("total"),0);assertSame(admission,transport.admitted());assertEquals(expiry,admission.expiresAt);assertEquals(generation,bridge.documentGeneration());
        JSONObject prompt=body(bridge,"storage.set").put("key",draft()).put("value","{\"savedAt\":1}").put("writerToken",token);assertTrue(new JSONObject(bridge.prompt("__reylumiPortableDevice:"+prompt,origin+"/pos/portable",origin+"/pos/portable")).getBoolean("ok"));
        server.ticketData=ticketData(0).put("setupMessage","Temporarily unavailable");server.reportData=reportData(0).put("setupMessage","Temporarily unavailable");transport.refreshReceiptReads(admission);
        assertEquals(50,transport.cachedResource("portable.report",new JSONObject(),SCOPE).getJSONObject("data").getJSONObject("totals").getDouble("expectedTotal"),0);
        assertEquals(50,transport.cachedResource("portable.ticket",new JSONObject().put("date",server.ticketData.getString("date")),SCOPE).getJSONObject("data").getJSONArray("tickets").getJSONObject(0).getDouble("total"),0);
        server.down=true;transport.refreshReceiptReads(admission);assertEquals(expiry,admission.expiresAt);assertEquals(1,transport.cachedResource("portable.ticket",new JSONObject(),SCOPE).getJSONObject("data").getJSONArray("tickets").length());assertFalse(transport.requiresOnline());
    }
    @Test public void sameAuthorityLateHttp200CannotReplaceNewerReceiptAckSnapshot()throws Exception{
        Server server=receiptServer();java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean hold=new java.util.concurrent.atomic.AtomicBoolean(true);
        PortableTransport.Http delayed=relative->{PortableTransport.Response response=server.get(relative);if(relative.contains("name=portable.ticket")&&hold.compareAndSet(true,false)){entered.countDown();if(!release.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("Fixture timeout");}return response;};
        PortableTransport transport=new PortableTransport(store,origin,server.cookies::get,delayed);PortableTransport.Admission admission=transport.prepare(SCOPE,"/pos/portable",false);long expiry=admission.expiresAt;
        java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
        try{
            java.util.concurrent.Future<JSONObject> old=worker.submit(()->transport.read("portable.ticket",new JSONObject(),SCOPE));assertTrue(entered.await(5,java.util.concurrent.TimeUnit.SECONDS));
            server.ticketData=ticketData(50);server.reportData=reportData(50);transport.refreshReceiptReads(admission);release.countDown();
            try{old.get(5,java.util.concurrent.TimeUnit.SECONDS);fail("Late old same-authority snapshot accepted");}catch(java.util.concurrent.ExecutionException expected){assertTrue(expected.getCause()instanceof PortableTransport.Denied);}
            assertSame(admission,transport.admitted());assertEquals(expiry,admission.expiresAt);assertEquals(50,transport.cachedResource("portable.ticket",new JSONObject().put("date",server.ticketData.getString("date")),SCOPE).getJSONObject("data").getJSONArray("tickets").getJSONObject(0).getDouble("total"),0);
            PortableHttpReadProjection.Request request=PortableHttpReadProjection.forResource("portable.ticket",new JSONObject());PortableTransport.ReadGuard older=transport.captureReadGuard(),newer=transport.captureReadGuard();
            assertTrue(transport.cacheHttpRead(admission,newer,request,ticketData(50)));assertFalse(transport.cacheHttpRead(admission,older,request,ticketData(0)));
        }finally{release.countDown();worker.shutdownNow();}
    }
}
