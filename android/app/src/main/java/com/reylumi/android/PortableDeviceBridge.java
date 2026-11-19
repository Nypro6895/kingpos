package com.reylumi.android;

import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

/** Page provenance is captured on the UI thread before work is queued. Native
 * admission and its document/lock fences are checked again before each ACK. */
final class PortableDeviceBridge {
    interface ModeHandler { String get(); String set(String mode) throws Exception; }
    private static final List<WeakReference<PortableDeviceBridge>> BRIDGES=new ArrayList<>();
    private static final Map<String,Long> LOCKS=new HashMap<>();
    private final PortableStore store;
    private final PortableTransport transport;
    private final String origin;
    private final PortableWriterRegistry writers=PortableWriterRegistry.SHARED;
    private final AtomicLong document=new AtomicLong();
    private final AtomicLong admissionRevision=new AtomicLong();
    private volatile String nonce=UUID.randomUUID().toString();
    private volatile PortableTransport.Admission active;
    private volatile long activeLockRevision;
    private volatile ModeHandler modes;
    private volatile java.util.function.BooleanSupplier offlineShellReady=()->false;

    PortableDeviceBridge(PortableStore store,PortableTransport transport,String origin){
        this.store=store;this.transport=transport;this.origin=origin;
        synchronized(BRIDGES){BRIDGES.removeIf(ref->ref.get()==null);BRIDGES.add(new WeakReference<>(this));}
    }
    void setModeHandler(ModeHandler handler){modes=handler;}
    void setOfflineShellReady(java.util.function.BooleanSupplier ready){offlineShellReady=ready==null?()->false:ready;}
    String nonce(){return nonce;}
    long documentGeneration(){return document.get();}
    private static long lockRevision(String origin){synchronized(LOCKS){return LOCKS.getOrDefault(origin,0L);}}
    private synchronized void invalidate(){active=null;admissionRevision.incrementAndGet();writers.releaseAll(this);}
    synchronized void documentWillNavigate(){document.incrementAndGet();nonce=UUID.randomUUID().toString();invalidate();}
    void dispose(){documentWillNavigate();synchronized(BRIDGES){BRIDGES.removeIf(ref->ref.get()==null||ref.get()==this);}}
    /** Explicit POS lock is device-wide; it never deletes pending work. */
    void lock() throws Exception{
        synchronized(LOCKS){LOCKS.put(origin,lockRevision(origin)+1);}
        List<PortableDeviceBridge> matching=new ArrayList<>();
        synchronized(BRIDGES){BRIDGES.removeIf(ref->ref.get()==null);for(WeakReference<PortableDeviceBridge> ref:BRIDGES){PortableDeviceBridge item=ref.get();if(item!=null&&origin.equals(item.origin))matching.add(item);}}
        Exception failed=null;for(PortableDeviceBridge bridge:matching){bridge.invalidate();try{bridge.transport.lock();}catch(Exception error){failed=error;}}
        if(failed!=null)throw failed;
    }
    private String path(String value)throws Exception{
        URI url=new URI(value),trusted=new URI(origin);
        if(url.getUserInfo()!=null||!trusted.getScheme().equals(url.getScheme())||!trusted.getRawAuthority().equals(url.getRawAuthority()))throw new PortableTransport.Denied(403);
        return (url.getRawPath()==null?"/":url.getRawPath())+(url.getRawQuery()==null?"":"?"+url.getRawQuery())+(url.getRawFragment()==null?"":"#"+url.getRawFragment());
    }
    private boolean valid(JSONObject body,String url,boolean mainFrame,long generation){
        try{return mainFrame&&body.optInt("version")==1&&nonce.equals(body.optString("nonce"))&&body.optLong("documentGeneration",-1)==generation&&generation==document.get()&&path(url).equals(body.optString("path"));}catch(Exception error){return false;}
    }
    private PortableTransport.Admission authorized(String scope){
        PortableTransport.Admission admission=active;
        if(admission==null||activeLockRevision!=lockRevision(origin)||!transport.valid(admission)){invalidate();return null;}
        return scope==null||scope.equals(admission.scope)?admission:null;
    }
    private static JSONObject error(String code,String message){try{return new JSONObject().put("__portableError",new JSONObject().put("code",code).put("error",message));}catch(Exception impossible){throw new IllegalStateException(impossible);}}
    private static JSONObject locked(){return error("storage-locked","Connect and unlock POS Portable before opening saved tickets.");}
    Object request(JSONObject body,String currentUrl,boolean trustedMainFrame,long capturedDocumentGeneration){
        if(!valid(body,currentUrl,trustedMainFrame,capturedDocumentGeneration))return error("untrusted-page","Portable storage is not available on this page.");
        long revision=admissionRevision.get();
        try{
            String action=body.optString("action");
            if(action.equals("mode.get"))return new JSONObject().put("mode",modes==null?"portable":modes.get());
            if(action.equals("mode.set")){String mode=body.optString("mode");if(!Arrays.asList("personal","portable").contains(mode))return error("invalid-mode","Choose a valid app mode.");if(modes==null)return error("unsupported-action","This POS app uses Portable mode.");return new JSONObject().put("mode",modes.set(mode));}
            if(action.equals("writer.release"))return new JSONObject().put("released",writers.release(origin,body.optString("key"),this,body.optString("token")));
            String requestedPath=PortableTransport.canonicalPath(path(currentUrl));if(requestedPath==null)return error("untrusted-page","Open POS Portable to access this device's saved tickets.");
            if(action.equals("storage.lock")){lock();return new JSONObject().put("ok",true);}
            if(action.equals("storage.prepare")){
                invalidate();revision=admissionRevision.get();long lock=lockRevision(origin);
                PortableTransport.Admission admission=transport.prepare(body.optString("scope"),requestedPath,transport.requiresOnline());
                // Match the existing iOS private Portable lease gate. A JS
                // request cannot turn localCommands off/on or extend expiry.
                synchronized(this){if(!admission.localCommands||revision!=admissionRevision.get()||lock!=lockRevision(origin)||!valid(body,currentUrl,trustedMainFrame,capturedDocumentGeneration)||!transport.valid(admission))return locked();activeLockRevision=lock;active=admission;return readiness(admission);}
            }
            PortableTransport.Admission admission=authorized(body.has("scope")?body.optString("scope"):null);if(admission==null)return locked();
            if(action.equals("writer.acquire")){
                String key=body.optString("key");if(!body.optString("scope").equals(admission.scope)||!key.startsWith("kingpos:portable-draft:v1:")||!PortableStore.validKey(key,admission.scope))return error("invalid-writer","Invalid POS draft writer.");
                WeakReference<PortableDeviceBridge> weak=new WeakReference<>(this);
                String token=writers.acquire(origin,key,this,()->{PortableDeviceBridge bridge=weak.get();return bridge!=null&&bridge.document.get()==capturedDocumentGeneration&&bridge.active==admission&&bridge.activeLockRevision==lockRevision(bridge.origin)&&bridge.transport.valid(admission);});
                JSONObject reply=new JSONObject().put("acquired",token!=null);if(token!=null)reply.put("token",token);return reply;
            }
            if(action.equals("offline.status")||action.equals("storage.status")){
                if(authorized(admission.scope)!=admission||!valid(body,currentUrl,trustedMainFrame,capturedDocumentGeneration))return locked();return readiness(admission);
            }
            Object reply;
            if(action.equals("operations.list")){if(!admission.scope.equals(body.optString("scope")))return locked();reply=store.list(admission.scope);}
            else if(action.equals("operations.checkpoint")){if(!admission.scope.equals(body.optString("scope")))return locked();reply=store.checkpoint(admission.scope,body.optString("key"));}
            else if(action.equals("operations.save")||action.equals("operations.import")){
                JSONObject operation=body.optJSONObject("operation");if(operation==null)return error("invalid-operation","Invalid POS operation.");
                boolean importing=action.equals("operations.import");
                if(importing&&!admission.scope.equals(body.optString("scope")))return locked();
                if(!importing&&!store.containsOperation(operation.optString("id"),admission.scope)){
                    String kind=operation.optString("kind"),capability=kind.equals("attendance")?"portable.checkin.use":kind.equals("booking")?"portable.book.create":"portable.pos.use";
                    if(!admission.offlineEnabled||!admission.capabilities.contains(capability))return error("offline-not-enabled","Offline changes are not enabled for this POS device. Reconnect before continuing.");
                    if(kind.equals("receipt")){
                        JSONObject payload=operation.optJSONObject("payload");String key=payload==null?"":payload.optString("localDraftKey");
                        if(!writers.owns(origin,key,this,body.optString("writerToken")))return error("writer-required","This POS window no longer owns the open ticket. Keep it open and check the other window.");
                    }
                }
                Double checkpoint=null;if(body.has("checkpointAt")){if(!(body.opt("checkpointAt")instanceof Number))return error("invalid-value","Invalid checkpoint.");checkpoint=body.getDouble("checkpointAt");}
                // A document/lock can change while an HTTP preparation is in
                // flight, but never acknowledge a command through that change.
                synchronized(this){if(revision!=admissionRevision.get()||authorized(admission.scope)!=admission||!valid(body,currentUrl,trustedMainFrame,capturedDocumentGeneration))return locked();store.save(operation,admission.scope,importing,checkpoint);reply=new JSONObject().put("ok",true);}
            }else return error("unsupported-action","Portable request is not supported.");
            if(revision!=admissionRevision.get()||authorized(admission.scope)!=admission||!valid(body,currentUrl,trustedMainFrame,capturedDocumentGeneration))return locked();
            return reply;
        }catch(PortableStore.Failure failure){return error(failure.code,"Portable storage could not confirm this save. Keep this ticket open and try again.");}
        catch(PortableTransport.Denied denied){if(revision==admissionRevision.get())invalidate();return locked();}
        catch(Exception failure){if(revision==admissionRevision.get())invalidate();return error("storage-unavailable","Portable storage could not confirm this save. Keep this ticket open and try again.");}
    }
    private JSONObject readiness(PortableTransport.Admission admission)throws Exception{
        return new JSONObject().put("ok",true).put("prepared",true).put("scope",admission.scope).put("pending",store.pendingCount(admission.scope)).put("storage","native").put("offlineReady",transport.offlineReady(admission)&&offlineShellReady.getAsBoolean()).put("expiresAt",Instant.ofEpochMilli(admission.expiresAt).toString());
    }
    /** A print job is a reference, never an authority or a source of money. */
    String validateProvisional(String scope,String operationId){
        try{
            PortableTransport.Admission admission=authorized(scope);
            if(admission==null||!admission.localCommands||!admission.capabilities.contains("portable.pos.use")||!transport.offlineReady(admission)||!offlineShellReady.getAsBoolean())return "storage-locked";
            if(operationId==null||!operationId.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"))return "invalid-operation";
            JSONArray operations=store.list(scope);
            for(int i=0;i<operations.length();i++){
                JSONObject operation=operations.getJSONObject(i);if(!operationId.equalsIgnoreCase(operation.optString("id")))continue;
                if(!"receipt".equals(operation.optString("kind"))||!"pending".equals(operation.optString("state"))||operation.has("rejected")&&!operation.isNull("rejected")&&!Boolean.FALSE.equals(operation.opt("rejected")))return "not-pending-receipt";
                JSONObject payload=operation.optJSONObject("payload");Object key=payload==null?null:payload.opt("localDraftKey");
                if(!(key instanceof String)||!((String)key).startsWith("kingpos:portable-draft:v1:"))return "checkpoint-required";
                double checkpoint=store.checkpoint(scope,(String)key);long occurred=java.time.OffsetDateTime.parse(operation.getString("occurredAt")).toInstant().toEpochMilli();
                if(!Double.isFinite(checkpoint)||checkpoint<=0||checkpoint<occurred||checkpoint>System.currentTimeMillis()+1000)return "checkpoint-required";
                if(!validPrintSnapshot(payload.optJSONObject("printSnapshot")))return "invalid-print-snapshot";
                return authorized(scope)==admission?null:"storage-locked";
            }return "invalid-operation";
        }catch(Exception failure){return "storage-unavailable";}
    }
    private static boolean validPrintSnapshot(JSONObject snapshot){
        try{
            if(snapshot==null||!(snapshot.opt("version")instanceof Number)||snapshot.getDouble("version")!=1||!"submitted-on-device".equals(snapshot.optString("completion"))||!"awaiting-server-validation".equals(snapshot.optString("paymentState"))||!(snapshot.opt("capturedAt")instanceof String))return false;
            long captured=java.time.OffsetDateTime.parse(snapshot.getString("capturedAt")).toInstant().toEpochMilli();if(captured < -8640000000000000L || captured > 8640000000000000L)return false;
            JSONArray lines=snapshot.optJSONArray("lines");JSONObject totals=snapshot.optJSONObject("totals");if(lines==null||lines.length()==0||totals==null)return false;
            for(int i=0;i<lines.length();i++){JSONObject line=lines.optJSONObject(i);if(line==null||!(line.opt("line_total")instanceof Number)||!Double.isFinite(line.getDouble("line_total"))||line.getDouble("line_total")<=0)return false;}
            for(String field:new String[]{"subtotal","discount","tax","tip","grand_total"})if(!(totals.opt(field)instanceof Number)||!Double.isFinite(totals.getDouble(field))||totals.getDouble(field)<0)return false;
            return true;
        }catch(Exception invalid){return false;}
    }
    synchronized String prompt(String message,String sourceUrl,String currentUrl){
        String prefix="__reylumiPortableDevice:";if(message==null||!message.startsWith(prefix))return null;
        try{
            if(message.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>8*1024*1024)return promptError("invalid-value");
            PortableStore.validateWireJson(message.substring(prefix.length()));
            JSONObject body=new JSONObject(message.substring(prefix.length()));
            if(!path(sourceUrl).equals(path(currentUrl))||!valid(body,currentUrl,true,document.get())||!PortableTransport.portablePath(path(currentUrl)))return promptError("storage-locked");
            PortableTransport.Admission admission=authorized(null);if(admission==null)return promptError("storage-locked");
            String action=body.optString("action"),key=body.optString("key");
            if(Arrays.asList("storage.set","storage.remove").contains(action)&&key.startsWith("kingpos:portable-draft:v1:")&&!writers.owns(origin,key,this,body.optString("writerToken")))return promptError("writer-required");
            JSONObject reply=new JSONObject().put("ok",true);
            if(action.equals("storage.get")){String value=store.get(key,admission.scope);reply.put("value",value==null?JSONObject.NULL:value);}
            else if(action.equals("storage.set")){if(!(body.opt("value")instanceof String))return promptError("invalid-value");store.set(key,body.getString("value"),admission.scope);}
            else if(action.equals("storage.remove"))store.remove(key,admission.scope);else return promptError("unsupported-action");
            if(authorized(admission.scope)!=admission||!valid(body,currentUrl,true,document.get()))return promptError("storage-locked");return reply.toString();
        }catch(Exception failure){return promptError("storage-unavailable");}
    }
    private static String promptError(String code){try{return new JSONObject().put("ok",false).put("code",code).put("error","Portable storage could not confirm this save. Keep this ticket open and try again.").toString();}catch(Exception impossible){return "{\"ok\":false,\"code\":\"storage-unavailable\"}";}}
}
