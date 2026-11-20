package com.reylumi.android;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.JsonReader;
import android.util.JsonToken;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Device-only encrypted ticket/outbox vault. Returned writes have committed
 * SQLite WAL/FULL. Financial bodies are never placed in the display cache. */
final class PortableStore implements AutoCloseable {
    static final int MAX_VALUE_BYTES = 4_000_000, MAX_OPERATION_BYTES = 2_000_000;
    private static final String UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    private static final Set<String> OP_FIELDS = new HashSet<>(Arrays.asList("sequence", "id", "scope", "kind", "occurredAt", "payload", "state", "result", "error", "cancelledAt", "syncedAt", "rejected"));
    private static final Set<String> DENIED = new HashSet<>(Arrays.asList("password", "passcode", "pin", "access_token", "refresh_token", "client_secret", "authorization", "cardnumber", "card_number", "cvc", "cvv"));
    private static final Object KEY_CREATION_LOCK=new Object();
    static final class Failure extends Exception {
        final String code;
        Failure(String code) { super(code); this.code = code; }
        Failure(String code, Exception cause) { super(code, cause); this.code = code; }
    }
    private final File directory, file;
    private final String keyAlias;
    private SQLiteDatabase database;
    private SecretKey encryptionKey;

    PortableStore(Context context, String origin) throws Exception {
        this(new File(context.getNoBackupFilesDir(), "ReylumiPortable"), origin, false);
    }
    // Package-private fixture root; production always uses Context.noBackupFilesDir.
    PortableStore(File root, String origin) throws Exception {
        this(root, origin, true);
    }
    private PortableStore(File root, String origin, boolean fixture) throws Exception {
        String identity = digest(origin);
        directory = new File(root, identity); file = new File(directory, "tickets.sqlite");
        keyAlias = "com.reylumi.portable-vault.v1." + identity + (fixture ? ".fixture." + digest(root.getCanonicalPath()) : "");
    }
    static boolean validScope(String scope) {
        return scope != null && scope.matches(UUID_PATTERN + ":" + UUID_PATTERN);
    }
    static boolean validKey(String key, String scope) {
        if (!validScope(scope) || key == null || bytes(key) > 2048 || key.chars().anyMatch(Character::isISOControl)) return false;
        if (key.equals("kingpos:portable-native-recovery:v1:" + scope)) return true;
        for (String prefix : new String[]{"kingpos:portable-draft:v1:", "kingpos:parked-tickets:v1:", "kingpos:closed-ticket-edits:v1:", "kingpos:report-inputs:", "kingpos:offline-staff:"}) {
            String owned = prefix + scope;
            if (key.equals(owned) || key.startsWith(owned + ":")) return true;
        }
        return false;
    }
    private static void scope(String scope) throws Failure { if (!validScope(scope)) throw new Failure("invalid-scope"); }
    private static void key(String key, String scope) throws Failure { if (!validKey(key, scope)) throw new Failure("invalid-key"); }
    private static void checkpointKey(String key, String scope) throws Failure {
        scope(scope); if (validKey(key, scope)) return;
        String prefix = "kingpos:portable-draft:v1:" + scope.split(":")[0] + ":";
        if (key == null || bytes(key) > 2048 || !key.startsWith(prefix) || !key.substring(prefix.length()).matches("[a-zA-Z0-9:._-]{1,1024}")) throw new Failure("invalid-key");
    }
    static String digest(String value) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(); for (byte b : hash) hex.append(String.format(Locale.ROOT, "%02x", b & 255)); return hex.toString();
    }
    private static int bytes(String value) { return value.getBytes(StandardCharsets.UTF_8).length; }
    private SecretKey key(boolean create) throws Exception {
        synchronized(KEY_CREATION_LOCK){
        if (encryptionKey != null) return encryptionKey;
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(keyAlias)) {
            java.security.Key found = store.getKey(keyAlias, null);
            if (!(found instanceof SecretKey)) throw new Failure("storage-unavailable");
            return encryptionKey = (SecretKey) found;
        }
        // Missing/invalidated key on an existing vault is never silently replaced.
        if (!create) throw new Failure("storage-unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build());
        return encryptionKey = generator.generateKey();
        }
    }
    private SQLiteDatabase open() throws Exception {
        if (database != null) return database;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Failure("storage-unavailable");
        key(!file.exists());
        SQLiteDatabase opened = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.CREATE_IF_NECESSARY);
        try {
            if (!opened.enableWriteAheadLogging()) throw new Failure("storage-unavailable");
            opened.execSQL("PRAGMA synchronous=FULL");
            try(Cursor setting=opened.rawQuery("PRAGMA busy_timeout=5000",null)){if(!setting.moveToFirst()||setting.getInt(0)!=5000)throw new Failure("storage-unavailable");}
            try(Cursor setting=opened.rawQuery("PRAGMA secure_delete=ON",null)){if(!setting.moveToFirst()||setting.getInt(0)!=1)throw new Failure("storage-unavailable");}
            opened.setForeignKeyConstraintsEnabled(true);
            try (Cursor mode = opened.rawQuery("PRAGMA synchronous", null)) {
                if (!mode.moveToFirst() || mode.getInt(0) != 2) throw new Failure("storage-unavailable");
            }
            if (opened.getVersion() > 1) throw new Failure("newer-version");
            opened.beginTransaction();
            try {
                opened.execSQL("CREATE TABLE IF NOT EXISTS saved (key TEXT PRIMARY KEY,body BLOB NOT NULL)");
                opened.execSQL("CREATE TABLE IF NOT EXISTS operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,scope TEXT NOT NULL,state TEXT NOT NULL,body BLOB NOT NULL,draft_key TEXT,checkpoint REAL)");
                opened.execSQL("CREATE INDEX IF NOT EXISTS operation_scope ON operations(scope,sequence)");
                // Replaceable encrypted GET/lease snapshots have a separate table.
                opened.execSQL("CREATE TABLE IF NOT EXISTS private_cache (key TEXT PRIMARY KEY,body BLOB NOT NULL)");
                opened.setVersion(1); opened.setTransactionSuccessful();
            } finally { opened.endTransaction(); }
            return database = opened;
        } catch (Exception error) { opened.close(); throw error; }
    }
    private byte[] seal(String value, String aad) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(false)); cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        if (iv.length != 12) throw new Failure("integrity");
        byte[] combined = new byte[1 + iv.length + encrypted.length]; combined[0] = 1;
        System.arraycopy(iv, 0, combined, 1, iv.length); System.arraycopy(encrypted, 0, combined, 13, encrypted.length); return combined;
    }
    private String unseal(byte[] value, String aad) throws Exception {
        try {
            if (value == null || value.length < 29 || value.length > MAX_VALUE_BYTES + 1024 || value[0] != 1) throw new Failure("integrity");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, value, 1, 12));
            cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8)); return new String(cipher.doFinal(value, 13, value.length - 13), StandardCharsets.UTF_8);
        } catch (Exception error) { throw new Failure("integrity", error); }
    }
    /** CursorWindow has a platform row limit below the vault's4MB contract.
     * A stable SQLite snapshot plus bounded chunks avoids acknowledging values
     * that cannot be read after a restart. SQL identifiers are native constants. */
    private byte[] body(SQLiteDatabase db,String table,String column,String identity)throws Exception{
        boolean transaction=!db.inTransaction();if(transaction)db.beginTransactionNonExclusive();
        try{
            int size;
            try(Cursor length=db.rawQuery("SELECT length(body) FROM "+table+" WHERE "+column+"=?",new String[]{identity})){
                if(!length.moveToFirst()){if(transaction)db.setTransactionSuccessful();return null;}
                long count=length.getLong(0);if(count<29||count>MAX_VALUE_BYTES+1024)throw new Failure("integrity");size=(int)count;
            }
            byte[] output=new byte[size];int offset=0;
            while(offset<size){int count=Math.min(128*1024,size-offset);
                try(Cursor chunk=db.rawQuery("SELECT substr(body,?,?) FROM "+table+" WHERE "+column+"=?",new String[]{String.valueOf(offset+1),String.valueOf(count),identity})){
                    if(!chunk.moveToFirst())throw new Failure("integrity");byte[] bytes=chunk.getBlob(0);if(bytes==null||bytes.length!=count)throw new Failure("integrity");System.arraycopy(bytes,0,output,offset,count);
                }offset+=count;
            }
            if(transaction)db.setTransactionSuccessful();return output;
        }finally{if(transaction)db.endTransaction();}
    }
    synchronized String get(String key, String scope) throws Exception {
        key(key, scope);byte[] encrypted=body(open(),"saved","key",key);return encrypted==null?null:unseal(encrypted,"saved|"+key);
    }
    synchronized void set(String key, String value, String scope) throws Exception {
        key(key, scope); if (value == null || bytes(value) > MAX_VALUE_BYTES) throw new Failure("invalid-value");
        if (key.startsWith("kingpos:portable-native-recovery:v1:")) {
            if (!validKey(value, scope) || !value.startsWith("kingpos:portable-draft:v1:")) throw new Failure("invalid-value");
        } else validateJson(value);
        SQLiteDatabase db = open(); byte[] encrypted = seal(value, "saved|" + key);
        db.execSQL("INSERT OR REPLACE INTO saved(key,body) VALUES(?,?)", new Object[]{key, encrypted});
    }
    synchronized void remove(String key, String scope) throws Exception { key(key, scope); open().execSQL("DELETE FROM saved WHERE key=?", new Object[]{key}); }
    synchronized JSONArray list(String scope) throws Exception {
        scope(scope); JSONArray rows = new JSONArray();
        SQLiteDatabase db=open();try (Cursor row = db.rawQuery("SELECT sequence,id FROM operations WHERE scope=? ORDER BY sequence", new String[]{scope})) {
            while (row.moveToNext()) {
                String id = row.getString(1); JSONObject value = new JSONObject(unseal(body(db,"operations","id",id), "operation|" + id + "|" + scope));
                if (!scope.equals(value.optString("scope")) || !id.equals(value.optString("id"))) throw new Failure("integrity");
                rows.put(value.put("sequence", row.getLong(0)));
            }
        } return rows;
    }
    synchronized double checkpoint(String scope, String key) throws Exception {
        checkpointKey(key, scope); try (Cursor row = open().rawQuery("SELECT MAX(checkpoint) FROM operations WHERE scope=? AND draft_key=?", new String[]{scope, digest(key)})) { return row.moveToFirst() && !row.isNull(0) ? row.getDouble(0) : 0; }
    }
    synchronized int pendingCount(String scope) throws Exception {
        if (scope != null) scope(scope);
        try (Cursor row = open().rawQuery("SELECT COUNT(*) FROM operations WHERE state NOT IN ('synced','cancelled')" + (scope == null ? "" : " AND scope=?"), scope == null ? null : new String[]{scope})) { if (!row.moveToFirst()) throw new Failure("storage-unavailable"); return row.getInt(0); }
    }
    synchronized boolean containsOperation(String id, String scope) throws Exception {
        scope(scope); if (id == null || !id.matches(UUID_PATTERN)) throw new Failure("invalid-operation");
        try (Cursor row = open().rawQuery("SELECT 1 FROM operations WHERE id=? AND scope=? LIMIT 1", new String[]{id.toLowerCase(Locale.ROOT), scope})) { return row.moveToFirst(); }
    }
    static String canonical(Object value) throws Exception {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value; List<String> keys = new ArrayList<>(); Iterator<String> it = object.keys(); while (it.hasNext()) keys.add(it.next()); Collections.sort(keys);
            List<String> entries = new ArrayList<>(); for (String key : keys) entries.add(JSONObject.quote(key) + ":" + canonical(object.get(key))); return "{" + String.join(",", entries) + "}";
        }
        if (value instanceof JSONArray) { List<String> entries = new ArrayList<>(); JSONArray array = (JSONArray) value; for (int i=0;i<array.length();i++) entries.add(canonical(array.get(i))); return "[" + String.join(",", entries) + "]"; }
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof String) return JSONObject.quote((String) value);
        if (value instanceof Number) { double number = ((Number) value).doubleValue(); if (!Double.isFinite(number)) throw new Failure("invalid-value"); return new java.math.BigDecimal(value.toString()).stripTrailingZeros().toPlainString(); }
        if (value instanceof Boolean) return value.toString(); throw new Failure("invalid-value");
    }
    private static void readJson(JsonReader reader, int depth) throws Exception {
        if (depth > 64) throw new Failure("invalid-value");
        JsonToken token = reader.peek();
        if (token == JsonToken.BEGIN_OBJECT) { reader.beginObject(); while(reader.hasNext()) { if(DENIED.contains(reader.nextName().toLowerCase(Locale.ROOT))) throw new Failure("invalid-value"); readJson(reader, depth+1); } reader.endObject(); }
        else if (token == JsonToken.BEGIN_ARRAY) { reader.beginArray(); while(reader.hasNext()) readJson(reader,depth+1); reader.endArray(); }
        else if (token == JsonToken.STRING) reader.nextString(); else if(token == JsonToken.NUMBER) { if(!Double.isFinite(Double.parseDouble(reader.nextString())))throw new Failure("invalid-value"); }
        else if (token == JsonToken.BOOLEAN) reader.nextBoolean(); else if(token == JsonToken.NULL) reader.nextNull(); else throw new Failure("invalid-value");
    }
    private static void validateJson(String raw) throws Exception {
        try (JsonReader reader = new JsonReader(new StringReader(raw))) {
            reader.setLenient(false); if(reader.peek()!=JsonToken.BEGIN_OBJECT&&reader.peek()!=JsonToken.BEGIN_ARRAY)throw new Failure("invalid-value");
            readJson(reader,0); if(reader.peek()!=JsonToken.END_DOCUMENT)throw new Failure("invalid-value");
        }
    }
    static void validateWireJson(String raw)throws Exception {if(raw==null||bytes(raw)>8*1024*1024)throw new Failure("invalid-value");validateJson(raw);}
    private static long timestamp(String value) throws Failure {
        try { return OffsetDateTime.parse(value).toInstant().toEpochMilli(); } catch(Exception error) { throw new Failure("invalid-operation",error); }
    }
    private static void validateOperation(JSONObject op, String scope) throws Exception {
        scope(scope); Iterator<String> keys=op.keys(); while(keys.hasNext())if(!OP_FIELDS.contains(keys.next()))throw new Failure("invalid-operation");
        if(!op.optString("id").matches(UUID_PATTERN)||!scope.equals(op.optString("scope"))||!Arrays.asList("receipt","attendance","booking","visit").contains(op.optString("kind"))||!Arrays.asList("pending","attention","synced","cancelled").contains(op.optString("state"))||!(op.opt("occurredAt") instanceof String)||!(op.opt("payload") instanceof JSONObject))throw new Failure("invalid-operation");
        timestamp(op.getString("occurredAt")); String raw=op.toString(); if(bytes(raw)>MAX_OPERATION_BYTES)throw new Failure("invalid-operation"); validateJson(raw);
        JSONObject payload=op.getJSONObject("payload"); if(op.getString("kind").equals("receipt")&&payload.has("localDraftKey")){if(!(payload.opt("localDraftKey") instanceof String))throw new Failure("invalid-key");checkpointKey(payload.getString("localDraftKey"),scope);}
    }
    private static boolean cancellable(JSONObject old) {
        if(!"attention".equals(old.optString("state")))return false; String error=old.optString("error");
        if("receipt".equals(old.optString("kind"))&&error.equals("Assigned staff must be checked in and working."))return true;
        if(!Boolean.TRUE.equals(old.opt("rejected")))return false;
        for(String prefix:new String[]{"This customer visit already has a ticket.","This customer visit is no longer available.","This staff member changed on another device."})if(error.startsWith(prefix))return true;return false;
    }
    synchronized JSONObject save(JSONObject input, String scope, boolean importing, Double checkpointAt) throws Exception {
        JSONObject value=new JSONObject(input.toString()); validateOperation(value,scope); long now=System.currentTimeMillis();
        if(checkpointAt!=null&&(!Double.isFinite(checkpointAt)||checkpointAt<0||checkpointAt>now))throw new Failure("invalid-value");
        String id=value.getString("id").toLowerCase(Locale.ROOT),next=value.getString("state");value.remove("sequence");value.put("id",id);
        SQLiteDatabase db=open(); db.beginTransaction();
        try {
            long sequence;
            try(Cursor row=db.rawQuery("SELECT sequence FROM operations WHERE id=?",new String[]{id})){
                if(row.moveToFirst()){
                    sequence=row.getLong(0);JSONObject old=new JSONObject(unseal(body(db,"operations","id",id),"operation|"+id+"|"+scope));
                    if(!scope.equals(old.optString("scope"))||!old.optString("kind").equals(value.optString("kind"))||!old.optString("occurredAt").equals(value.optString("occurredAt"))||!canonical(old.opt("payload")).equals(canonical(value.opt("payload"))))throw new Failure("immutable-operation");
                    if(importing){db.setTransactionSuccessful();return old.put("sequence",sequence);}
                    String previous=old.getString("state");if(previous.equals("synced")&&!next.equals("synced")||previous.equals("cancelled")&&!next.equals("cancelled")||next.equals("cancelled")&&!previous.equals("cancelled")&&!cancellable(old))throw new Failure("invalid-transition");
                    db.execSQL("UPDATE operations SET state=?,body=? WHERE id=?",new Object[]{next,seal(value.toString(),"operation|"+id+"|"+scope),id});
                }else{
                    if(!next.equals("pending")&&!importing)throw new Failure("invalid-transition");
                    JSONObject payload=value.getJSONObject("payload");String draft=value.getString("kind").equals("receipt")?payload.optString("localDraftKey",null):null;
                    double savedAt=importing?(checkpointAt==null?Math.max(0,Math.min(now,timestamp(value.getString("occurredAt")))):checkpointAt):now;
                    if(!importing&&draft!=null&&validKey(draft,scope)){String raw=get(draft,scope);if(raw!=null){Object parsed=new JSONTokener(raw).nextValue();Object saved=parsed instanceof JSONObject?((JSONObject)parsed).opt("savedAt"):null;if(saved instanceof Number&&Double.isFinite(((Number)saved).doubleValue()))savedAt=Math.max(savedAt,((Number)saved).doubleValue());}}
                    db.execSQL("INSERT INTO operations(id,scope,state,body,draft_key,checkpoint) VALUES(?,?,?,?,?,?)",new Object[]{id,scope,next,seal(value.toString(),"operation|"+id+"|"+scope),draft==null?null:digest(draft),draft==null?null:savedAt});
                    try(Cursor seq=db.rawQuery("SELECT last_insert_rowid()",null)){if(!seq.moveToFirst())throw new Failure("storage-unavailable");sequence=seq.getLong(0);}
                }
            }
            db.setTransactionSuccessful();return value.put("sequence",sequence);
        }finally{db.endTransaction();}
    }
    // Native transport-only encrypted cache. Not exposed by the JS dispatcher.
    synchronized JSONObject cached(String key) throws Exception {
        byte[] encrypted=body(open(),"private_cache","key",key);return encrypted==null?null:new JSONObject(unseal(encrypted,"cache|"+key));
    }
    synchronized void cache(String key, JSONObject value) throws Exception {
        if(key==null||bytes(key)>2048||value==null||bytes(value.toString())>MAX_VALUE_BYTES)throw new Failure("invalid-value");
        SQLiteDatabase db=open();db.execSQL("INSERT OR REPLACE INTO private_cache(key,body) VALUES(?,?)",new Object[]{key,seal(value.toString(),"cache|"+key)});
    }
    synchronized void removeCache(String key) throws Exception {open().execSQL("DELETE FROM private_cache WHERE key=?",new Object[]{key});}
    synchronized JSONObject cacheGet(String key) throws Exception { return cached(key); }
    synchronized void cachePut(String key, JSONObject value) throws Exception { cache(key, value); }
    synchronized void cacheDrop(String key) throws Exception { removeCache(key); }
    /** Only replaceable display assets/other-scope HTML are pruned. */
    synchronized void cachePruneDisplay(String build,String scope)throws Exception{
        if(build==null||!build.matches("[a-f0-9]{64}")||!validScope(scope))throw new Failure("invalid-value");
        SQLiteDatabase db=open();List<String> stale=new ArrayList<>();String prefix="display:v1:";
        try(Cursor keys=db.rawQuery("SELECT key FROM private_cache WHERE key LIKE 'display:v1:%'",null)){
            while(keys.moveToNext()){
                String key=keys.getString(0),rest=key.substring(prefix.length());int split=rest.indexOf('|');if(split<0)continue;
                String identity=rest.substring(0,split),path=rest.substring(split+1);
                if(identity.matches("[a-f0-9]{64}")&&path.startsWith("/_next/static/")&&!identity.equals(build))stale.add(key);
                else if(validScope(identity)&&PortableTransport.portablePath(path)&&!identity.equals(scope))stale.add(key);
            }
        }
        db.beginTransaction();try{for(String key:stale)db.execSQL("DELETE FROM private_cache WHERE key=?",new Object[]{key});db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    File databaseFile(){return file;}
    String keyAlias(){return keyAlias;}
    @Override public synchronized void close(){if(database!=null){database.close();database=null;}encryptionKey=null;}
}
