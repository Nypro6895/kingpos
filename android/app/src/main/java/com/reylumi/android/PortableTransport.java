package com.reylumi.android;

import android.webkit.CookieManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Native-owned GET admission/cache. JS context, URLs and cookie values never
 * create authority. This is the existing HTTPS/private POS lease contract. */
final class PortableTransport {
    interface Cookies { String header(); }
    interface Http { Response get(String relativeUrl) throws Exception; }
    static final class Response {
        final int status; final JSONObject body;
        Response(int status, JSONObject body) { this.status=status;this.body=body; }
    }
    static final class Denied extends Exception {
        final int status;
        Denied(int status) { super("Portable access could not be verified");this.status=status; }
    }
    static final class Admission {
        final String scope,path,generation,revision,fingerprint;
        final long expiresAt,epoch;
        final boolean localCommands,offlineEnabled,offline;
        final Set<String> capabilities;
        final JSONObject context;
        Admission(String scope,String path,String generation,String revision,String fingerprint,long expiresAt,long epoch,boolean commands,Set<String> capabilities,JSONObject context,boolean offline) throws Exception {
            this.scope=scope;this.path=path;this.generation=generation;this.revision=revision;this.fingerprint=fingerprint;this.expiresAt=expiresAt;this.epoch=epoch;this.localCommands=commands;
            this.offlineEnabled=commands&&context.getJSONObject("portable").optBoolean("offlineEnabled");this.capabilities=Collections.unmodifiableSet(capabilities);this.context=new JSONObject(context.toString());this.offline=offline;
        }
    }
    private static final String META="portable-transport:v1";
    // Display read ordering is process-wide across native windows. It is not
    // authority and never survives as a usable guard across a process restart.
    private static final String READ_SESSION=UUID.randomUUID().toString();
    private static final java.util.concurrent.atomic.AtomicLong READ_SEQUENCE=new java.util.concurrent.atomic.AtomicLong();
    private static final List<String> COOKIE_NAMES=Arrays.asList("kingpos-portable-pos-key-id","kingpos-portable-pos-session","kingpos-workspace-device","kingpos-portable-local-lock");
    private static final Map<String,String> READS;
    static {Map<String,String> reads=new java.util.LinkedHashMap<>();reads.put("portable.workspace","portable.pos.use");reads.put("portable.check-in","portable.checkin.use");reads.put("portable.book","portable.book.view");reads.put("portable.ticket","portable.today.view");reads.put("portable.report","portable.report.view");READS=Collections.unmodifiableMap(reads);}
    final String origin;
    private final PortableStore store;
    private final Cookies cookies;
    private final Http http;
    private volatile Admission current;
    private volatile long epoch;
    private final java.util.concurrent.atomic.AtomicLong prepareFlight=new java.util.concurrent.atomic.AtomicLong();
    private volatile JSONObject metadata;

    PortableTransport(PortableStore store,String origin) throws Exception {
        this(store,origin,()->CookieManager.getInstance().getCookie(origin),null);
    }
    PortableTransport(PortableStore store,String origin,Cookies cookies,Http http) throws Exception {
        if(!origin.equals(NavigationPolicy.appOrigin()))throw new Denied(403);
        this.store=store;this.origin=origin;this.cookies=cookies;this.http=http==null?this::nativeGet:http;
        metadata=store.cacheGet(META);
        if(metadata==null){metadata=new JSONObject().put("generation",UUID.randomUUID().toString()).put("blocked",false);store.cachePut(META,metadata);}
        if(!metadata.optString("generation").matches("[\\w-]{16,100}"))throw new Denied(403);
    }
    private static String encode(String value){try{return URLEncoder.encode(value,"UTF-8");}catch(Exception error){throw new IllegalArgumentException(error);}}
    private String cookie(String name){String raw=cookies.header();if(raw==null)return null;for(String part:raw.split(";")){int split=part.indexOf('=');if(split>0&&name.equals(part.substring(0,split).trim()))return part.substring(split+1).trim();}return null;}
    private String fingerprint() throws Exception {
        if(cookie("kingpos-portable-pos-key-id")==null||cookie("kingpos-portable-pos-session")==null||"1".equals(cookie("kingpos-portable-local-lock")))throw new Denied(401);
        StringBuilder value=new StringBuilder(origin);for(String name:COOKIE_NAMES)value.append('\0').append(name).append('=').append(cookie(name)==null?"":cookie(name));return PortableStore.digest(value.toString());
    }
    static String canonicalPath(String path){
        try{
            if(path==null||path.length()>2048||!path.startsWith("/")||path.startsWith("//")||path.matches("(?s).*[\\\\\\x00-\\x1f].*")||path.matches("(?is).*%(2f|5c|00).*"))return null;
            URI uri=new URI(path);if(uri.isAbsolute()||uri.getRawAuthority()!=null||uri.getRawFragment()!=null)return null;
            String bare=uri.getRawPath();if(bare.endsWith("/"))bare=bare.substring(0,bare.length()-1);
            if(!Arrays.asList("/pos/portable","/pos/portable/check-in","/pos/portable/book","/pos/portable/ticket","/pos/portable/today","/pos/portable/report").contains(bare))return null;
            if(uri.getRawQuery()==null||uri.getRawQuery().isEmpty())return bare;
            List<String[]> entries=new java.util.ArrayList<>();
            for(String pair:uri.getRawQuery().split("&")){if(pair.isEmpty())continue;String[] split=pair.split("=",2);String key=java.net.URLDecoder.decode(split[0],"UTF-8"),value=java.net.URLDecoder.decode(split.length==1?"":split[1],"UTF-8");
                if(key.matches("(?i)token|access_token|refresh_token|code|secret|signature|session|session_id|password|client_secret|payment|bookingStripe|checkout|payment_intent|payment_intent_client_secret|setup_intent|setup_intent_client_secret|redirect_status|key|invite|next|return_to")||value.length()>512||value.matches("(?is).*(token|secret|password)=.*"))return null;entries.add(new String[]{key,value});}
            entries.sort((a,b)->a[0].compareTo(b[0]));List<String> pairs=new java.util.ArrayList<>();for(String[] entry:entries)pairs.add(encode(entry[0])+"="+encode(entry[1]));return bare+(pairs.isEmpty()?"":"?"+String.join("&",pairs));
        }catch(Exception error){return null;}
    }
    static boolean portablePath(String path){return canonicalPath(path)!=null;}
    static String pathCapability(String path){String bare=URI.create(path).getPath();if(bare.endsWith("/"))bare=bare.substring(0,bare.length()-1);return bare.equals("/pos/portable")?"portable.pos.use":bare.equals("/pos/portable/check-in")?"portable.checkin.use":bare.equals("/pos/portable/book")?"portable.book.view":bare.equals("/pos/portable/report")?"portable.report.view":"portable.today.view";}
    private Response nativeGet(String relative) throws Exception {
        URI target=new URI(origin+relative);
        if(!target.getScheme().equals(new URI(origin).getScheme())||!target.getRawAuthority().equals(new URI(origin).getRawAuthority())||target.getUserInfo()!=null||target.getFragment()!=null||!relative.startsWith("/api/"))throw new Denied(403);
        HttpURLConnection connection=(HttpURLConnection)target.toURL().openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(28000);connection.setUseCaches(false);connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("User-Agent","ReylumiAndroid/1.0 ReylumiAndroidPOS/1.0");
        String header=cookies.header();if(header!=null)connection.setRequestProperty("Cookie",header);
        try {
            int status=connection.getResponseCode();
            if(status>=300&&status<400)throw new Denied(403);
            if(status>=200&&status<300){
                Map<String,List<String>> fields=connection.getHeaderFields();
                for(Map.Entry<String,List<String>> field:fields.entrySet())if(field.getKey()!=null&&field.getKey().equalsIgnoreCase("Set-Cookie"))for(String set:field.getValue())CookieManager.getInstance().setCookie(origin,set);
            }
            InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
            if(input==null)return new Response(status,new JSONObject());
            try(InputStream stream=input;ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int count;
                while((count=stream.read(buffer))!=-1){if(output.size()+count>PortableStore.MAX_VALUE_BYTES)throw new Denied(413);output.write(buffer,0,count);}
                return new Response(status,new JSONObject(output.toString("UTF-8")));
            }
        } finally {connection.disconnect();}
    }
    private Admission verified(JSONObject value,String path,String expectedScope,boolean offline) throws Exception {
        long now=System.currentTimeMillis();JSONObject context=value.optJSONObject("context"),grant=value.optJSONObject("grant"),portable=value.optJSONObject("portable");
        if(!portablePath(path)||value.optInt("schemaVersion")!=1||value.optInt("grantStatus")!=200||"unconfirmed".equals(value.optString("offlineState"))||context==null||grant==null||portable==null||grant.optInt("version")!=1||!"portable".equals(grant.optString("kind")))throw new Denied(403);
        String scope=context.optString("scope"),revision=grant.optString("grantRevision"),generation=metadata.getString("generation");
        if(!PortableStore.validScope(scope)||expectedScope!=null&&!expectedScope.equals(scope)||!scope.equals(grant.optString("scope"))||!scope.equals(portable.optString("scope"))||!generation.equals(grant.optString("generation"))||!path.equals(grant.optString("path"))||revision.isEmpty()||revision.length()>8192||!revision.equals(context.optString("permissionRevision"))||!Boolean.FALSE.equals(context.opt("authenticated"))||!(grant.opt("localCommands") instanceof Boolean))throw new Denied(403);
        String[] parts=scope.split(":");
        if(!parts[0].equals(context.optString("salonId"))||!parts[0].equals(grant.optString("salonId"))||!parts[0].equals(portable.optString("salonId"))||!parts[1].equals(context.optString("workspaceId"))||!parts[1].equals(grant.optString("workspaceId"))||!parts[1].equals(portable.optString("keyId"))||!parts[1].equals(cookie("kingpos-portable-pos-key-id"))||!String.valueOf(context.opt("viewerId")).equals(String.valueOf(grant.opt("viewerId"))))throw new Denied(403);
        JSONArray scopes=grant.optJSONArray("scopes"),caps=portable.optJSONArray("capabilities");boolean included=false;
        if(scopes==null||scopes.length()<1||scopes.length()>4||caps==null||caps.length()>64)throw new Denied(403);
        for(int i=0;i<scopes.length();i++){if(!(scopes.opt(i)instanceof String))throw new Denied(403);if(scope.equals(scopes.getString(i)))included=true;}
        if(!included||!(grant.opt("issuedAt")instanceof Number)||!(grant.opt("expiresAt")instanceof Number))throw new Denied(403);
        double issued=grant.getDouble("issuedAt"),expires=grant.getDouble("expiresAt");
        if(!Double.isFinite(issued)||!Double.isFinite(expires)||issued>now+60000||expires<=now||expires<=issued||expires-issued>86400000)throw new Denied(403);
        Set<String> capabilities=new HashSet<>();for(int i=0;i<caps.length();i++){if(!(caps.opt(i)instanceof String)||caps.getString(i).length()>128)throw new Denied(403);capabilities.add(caps.getString(i));}
        if(!capabilities.contains(pathCapability(path)))throw new Denied(403);
        return new Admission(scope,path,generation,revision,fingerprint(),(long)expires,epoch,grant.getBoolean("localCommands"),capabilities,value,offline);
    }
    private synchronized void accepted(Admission admission) throws Exception {
        if(current!=null&&(!current.scope.equals(admission.scope)||!current.revision.equals(admission.revision)||!current.fingerprint.equals(admission.fingerprint)))epoch++;
        JSONObject next=new JSONObject(metadata.toString()).put("blocked",false).put("scope",admission.scope).put("revision",admission.revision).put("fingerprint",admission.fingerprint);
        store.cachePut(META,next);metadata=next;
        current=new Admission(admission.scope,admission.path,admission.generation,admission.revision,admission.fingerprint,admission.expiresAt,epoch,admission.localCommands,new HashSet<>(admission.capabilities),admission.context,admission.offline);
    }
    private synchronized void rejectCurrent(long startedEpoch,long flight,String fingerprint)throws Exception{
        if(startedEpoch==epoch&&flight==prepareFlight.get()&&fingerprint.equals(fingerprint()))lock();
    }
    /** Opaque native-only identity for a network read, including cold launch
     * before current admission has been restored. Never exposed to JavaScript. */
    static final class ReadGuard {
        private final long epoch,flight,order;
        private final String fingerprint;
        private ReadGuard(long epoch,long flight,String fingerprint,long order){this.epoch=epoch;this.flight=flight;this.fingerprint=fingerprint;this.order=order;}
    }
    synchronized ReadGuard captureReadGuard() {
        try{return new ReadGuard(epoch,prepareFlight.get(),fingerprint(),READ_SEQUENCE.incrementAndGet());}
        catch(Exception unavailable){return null;}
    }
    synchronized boolean rejectRead(ReadGuard guard)throws Exception{
        if(guard==null||guard.epoch!=epoch||guard.flight!=prepareFlight.get())return false;
        String currentFingerprint;
        try{currentFingerprint=fingerprint();}catch(Exception unavailable){return false;}
        if(!guard.fingerprint.equals(currentFingerprint))return false;
        lock();return true;
    }
    private boolean sameRead(ReadGuard guard){
        try{return guard!=null&&guard.epoch==epoch&&guard.flight==prepareFlight.get()&&guard.fingerprint.equals(fingerprint());}
        catch(Exception unavailable){return false;}
    }
    Admission prepare(String scope,String path,boolean requireOnline) throws Exception {
        path=canonicalPath(path);if(!PortableStore.validScope(scope)||path==null)throw new Denied(403);
        final long startedEpoch,flight;final String startedFingerprint;Admission result;
        synchronized(this){startedEpoch=epoch;flight=prepareFlight.incrementAndGet();startedFingerprint=fingerprint();requireOnline=requireOnline||metadata.optBoolean("blocked",true);}
        try {
            Response response=http.get("/api/app-local/context?path="+encode(path)+"&generation="+encode(metadata.getString("generation")));
            if(startedEpoch!=epoch||flight!=prepareFlight.get()||!startedFingerprint.equals(fingerprint()))throw new Denied(409);
            if(response.status==401||response.status==403||response.status==409){rejectCurrent(startedEpoch,flight,startedFingerprint);throw new Denied(response.status);}
            if(response.status!=200)throw new Denied(response.status);
            Admission admission;
            try{admission=verified(response.body,path,scope,false);}catch(Exception error){rejectCurrent(startedEpoch,flight,startedFingerprint);throw error;}
            synchronized(this){if(startedEpoch!=epoch||flight!=prepareFlight.get()||!startedFingerprint.equals(fingerprint()))throw new Denied(409);accepted(admission);result=current;store.cachePut("context|"+path,new JSONObject().put("context",response.body).put("fingerprint",result.fingerprint));}
        }catch(IOException network){synchronized(this){if(requireOnline||startedEpoch!=epoch||flight!=prepareFlight.get()||!startedFingerprint.equals(fingerprint()))throw network;result=restoreDocumentAdmission(path);if(result==null||!scope.equals(result.scope))throw new Denied(401);}}
        if(!valid(result)||flight!=prepareFlight.get())throw new Denied(401);
        if(!valid(result)||flight!=prepareFlight.get())throw new Denied(401);return result;
    }
    /** Background shell warming may persist a server-verified sibling route,
     * but cannot replace the editor's current admission or extend its lease. */
    Admission warmDocumentAdmission(String scope,String path)throws Exception{
        path=canonicalPath(path);Admission prior=current;long flight=prepareFlight.get();
        if(path==null||!valid(prior)||!scope.equals(prior.scope)||!prior.capabilities.contains(pathCapability(path)))throw new Denied(403);
        long startedEpoch=epoch;String fingerprint=prior.fingerprint;
        Response response=http.get("/api/app-local/context?path="+encode(path)+"&generation="+encode(prior.generation));
        if(!valid(prior)||flight!=prepareFlight.get()||!fingerprint.equals(fingerprint()))throw new Denied(409);
        if(Arrays.asList(401,403,409).contains(response.status)){rejectCurrent(startedEpoch,flight,fingerprint);throw new Denied(response.status);}
        if(response.status!=200)throw new Denied(response.status);
        Admission route;
        try{route=verified(response.body,path,scope,false);}catch(Exception error){rejectCurrent(startedEpoch,flight,fingerprint);throw error;}
        synchronized(this){
            if(!valid(prior)||flight!=prepareFlight.get()||!fingerprint.equals(fingerprint()))throw new Denied(409);
            if(!route.revision.equals(prior.revision)||!route.capabilities.equals(prior.capabilities)||route.localCommands!=prior.localCommands){rejectCurrent(startedEpoch,flight,fingerprint);throw new Denied(409);}
            store.cachePut("context|"+path,new JSONObject().put("context",response.body).put("fingerprint",fingerprint));
        }return route;
    }
    synchronized Admission restoreDocumentAdmission(String path) throws Exception {
        path=canonicalPath(path);if(path==null||metadata.optBoolean("blocked",true))return null;
        JSONObject stored=store.cacheGet("context|"+path);if(stored==null)return null;
        String fingerprint=fingerprint();
        if(!fingerprint.equals(stored.optString("fingerprint"))||!fingerprint.equals(metadata.optString("fingerprint")))return null;
        Admission restored=verified(stored.getJSONObject("context"),path,metadata.optString("scope"),true);
        if(!restored.revision.equals(metadata.optString("revision"))||!restored.localCommands)return null;
        current=restored;return restored;
    }
    boolean valid(Admission admission){
        try{return admission!=null&&admission.epoch==epoch&&!metadata.optBoolean("blocked",true)&&admission.expiresAt>System.currentTimeMillis()&&admission.fingerprint.equals(fingerprint())&&admission.scope.equals(metadata.optString("scope"))&&admission.revision.equals(metadata.optString("revision"));}catch(Exception error){return false;}
    }
    synchronized void lock() throws Exception {epoch++;current=null;metadata=new JSONObject(metadata.toString()).put("blocked",true);store.cachePut(META,metadata);}
    boolean requiresOnline(){return metadata.optBoolean("blocked",true);}
    Admission admitted(){Admission admission=current;return valid(admission)?admission:null;}
    JSONObject admittedContext() throws Exception {Admission admission=current;if(!valid(admission))return null;return new JSONObject(admission.context.toString()).put("offline",admission.offline).put("contextPath",admission.path);}
    private String readKey(String name,JSONObject args,String scope)throws Exception{return "read|"+scope+"|"+name+"|"+PortableStore.canonical(args);}
    JSONObject cachedResource(String name,JSONObject args,String scope)throws Exception{
        Admission admission=current;if(!valid(admission)||!admission.scope.equals(scope)||!READS.containsKey(name)||!admission.capabilities.contains(READS.get(name)))return null;
        validateArgs(name,args);JSONObject cached=store.cacheGet(readKey(name,args,scope));
        if(cached==null||!admission.fingerprint.equals(cached.optString("fingerprint"))||!admission.revision.equals(cached.optString("revision")))return null;
        JSONObject reply=cached.getJSONObject("reply");PortableHttpReadProjection.Request projection=PortableHttpReadProjection.forResource(name,args);
        return projection==null||projection.accepts(reply.optJSONObject("data"))?reply:null;
    }
    private static void validateArgs(String name,JSONObject args)throws Exception{
        java.util.Iterator<String> keys=args.keys();while(keys.hasNext()){String key=keys.next();if(!"date".equals(key)||name.equals("portable.workspace")||name.equals("portable.check-in")||!(args.opt(key)instanceof String)||!args.getString(key).matches("\\d{4}-\\d{2}-\\d{2}"))throw new Denied(400);}
        if(Arrays.asList("portable.ticket","portable.report").contains(name)&&PortableHttpReadProjection.forResource(name,args)==null)throw new Denied(400);
    }
    /** Only the native exact-origin GET interceptor may supply this data.
     * No JS action dispatches here, and the original server DTO is unchanged. */
    synchronized boolean cacheHttpRead(Admission captured,ReadGuard guard,PortableHttpReadProjection.Request request,JSONObject data)throws Exception{
        if(captured==null||current!=captured||!valid(captured)||!sameRead(guard)||request==null
            ||!READS.containsKey(request.name)||!captured.capabilities.contains(request.capability)||!request.accepts(data))return false;
        if(data.has("salonId")&&!captured.scope.split(":")[0].equals(data.opt("salonId"))
            ||data.has("closingScope")&&!captured.scope.equals(data.opt("closingScope")))return false;
        JSONObject args=request.args();validateArgs(request.name,args);
        JSONObject reply=new JSONObject().put("schemaVersion",1).put("status",200).put("scope",captured.scope).put("updatedAt",System.currentTimeMillis()).put("data",data);
        return cacheReply(captured,guard,request.name,args,reply,request);
    }
    private boolean cacheReply(Admission admission,ReadGuard guard,String name,JSONObject args,JSONObject reply,PortableHttpReadProjection.Request projection)throws Exception{
        if(current!=admission||!valid(admission)||!sameRead(guard))return false;
        List<String> keys=new java.util.ArrayList<>();keys.add(readKey(name,args,admission.scope));
        if(projection!=null&&projection.isToday(reply.getJSONObject("data")))keys.add(readKey(name,args.length()>0?new JSONObject():projection.datedArgs(reply.getJSONObject("data")),admission.scope));
        for(String key:keys){JSONObject prior=store.cacheGet(key);if(prior!=null&&READ_SESSION.equals(prior.optString("nativeReadSession"))&&prior.optLong("nativeReadOrder",-1)>guard.order)return false;}
        JSONObject sealed=new JSONObject().put("reply",reply).put("fingerprint",admission.fingerprint).put("revision",admission.revision).put("nativeReadSession",READ_SESSION).put("nativeReadOrder",guard.order);
        for(String key:keys)store.cachePut(key,sealed);return true;
    }
    JSONObject read(String name,JSONObject args,String scope)throws Exception{
        final Admission admission;final ReadGuard guard;final long flight;
        synchronized(this){admission=current;guard=captureReadGuard();flight=prepareFlight.get();if(!valid(admission)||guard==null||!scope.equals(admission.scope)||!READS.containsKey(name)||!admission.capabilities.contains(READS.get(name)))throw new Denied(403);}
        validateArgs(name,args);
        try{
            Response response=http.get("/api/app-local/read?name="+encode(name)+"&args="+encode(args.toString())+"&scope="+encode(scope));
            if(Arrays.asList(401,403,409).contains(response.status)){synchronized(this){if(current==admission)rejectCurrent(admission.epoch,flight,admission.fingerprint);}throw new Denied(response.status);}
            if(response.status!=200)throw new Denied(response.status);
            JSONObject reply=response.body;if(reply.optInt("schemaVersion")!=1||reply.optInt("status")!=200||!scope.equals(reply.optString("scope"))||!reply.has("data"))throw new Denied(403);
            PortableHttpReadProjection.Request projection=PortableHttpReadProjection.forResource(name,args);
            if(projection!=null&&!projection.accepts(reply.optJSONObject("data")))throw new Denied(503);
            synchronized(this){
                if(!valid(admission)||flight!=prepareFlight.get()||current!=admission)throw new Denied(409);
                if(!cacheReply(admission,guard,name,args,reply,projection))throw new Denied(409);
            }return reply;
        }catch(IOException network){if(flight!=prepareFlight.get()||current!=admission)throw network;JSONObject cached=cachedResource(name,args,scope);if(cached==null)throw network;return cached;}
    }
    void warm(Admission admission)throws Exception{
        if(!valid(admission)||!admission.offlineEnabled)return;
        for(Map.Entry<String,String> resource:READS.entrySet())if(admission.capabilities.contains(resource.getValue())){
            if(current!=admission||!valid(admission))return;
            try{read(resource.getKey(),new JSONObject(),admission.scope);}catch(Denied failure){if(!valid(admission))throw failure;}catch(IOException unavailable){/* Preserve good existing data without extending its authority. */}
        }
        if(admission.capabilities.contains("portable.checkin.use")&&valid(admission)){
            String key="kingpos:offline-staff:"+admission.scope;String existing=store.get(key,admission.scope);
            if(existing!=null&&staffReady(new JSONObject(existing),admission))return;
            long flight=prepareFlight.get();
            try{Response response=http.get("/api/pos/portable/offline-staff");
                if(Arrays.asList(401,403,409).contains(response.status)){synchronized(this){if(current==admission)rejectCurrent(admission.epoch,flight,admission.fingerprint);}throw new Denied(response.status);}
                synchronized(this){if(response.status==200&&staffReady(response.body,admission)&&valid(admission)&&flight==prepareFlight.get()&&current==admission)store.set(key,response.body.toString(),admission.scope);}
            }catch(IOException unavailable){/* No staff bundle means check-in is not prepared. */}
        }
    }
    /** Receipt ACK refresh is background GET work only: it cannot prepare a
     * different authority, reset a writer, or change the financial command. */
    void refreshReceiptReads(Admission admission)throws Exception{
        for(String name:Arrays.asList("portable.ticket","portable.report")){
            if(current!=admission||!valid(admission))return;
            if(!admission.capabilities.contains(READS.get(name)))continue;
            try{read(name,new JSONObject(),admission.scope);}
            catch(Denied failure){if(!valid(admission))throw failure;}
            catch(IOException unavailable){/* The last good server DTO remains; a later online refresh may retry. */}
        }
    }
    private boolean staffReady(JSONObject staff,Admission admission){return admission.scope.equals(staff.optString("scope"))&&staff.optDouble("expiresAt")>System.currentTimeMillis()&&staff.optJSONArray("staff")!=null&&staff.opt("publicKey")instanceof String;}
    boolean offlineReady(Admission admission)throws Exception{
        if(!valid(admission)||!admission.offlineEnabled)return false;
        for(Map.Entry<String,String> resource:READS.entrySet())if(admission.capabilities.contains(resource.getValue())&&cachedResource(resource.getKey(),new JSONObject(),admission.scope)==null)return false;
        if(admission.capabilities.contains("portable.checkin.use")){String raw=store.get("kingpos:offline-staff:"+admission.scope,admission.scope);if(raw==null||!staffReady(new JSONObject(raw),admission))return false;}
        return valid(admission);
    }
}
