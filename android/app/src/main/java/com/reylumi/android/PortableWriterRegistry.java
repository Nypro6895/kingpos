package com.reylumi.android;

import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** Process-wide fencing across WebViews. A live writer is never evicted by age. */
final class PortableWriterRegistry {
    static final PortableWriterRegistry SHARED = new PortableWriterRegistry();
    private static final class Claim {
        final WeakReference<Object> owner;
        final String token = UUID.randomUUID().toString();
        final BooleanSupplier valid;
        Claim(Object owner, BooleanSupplier valid) { this.owner = new WeakReference<>(owner); this.valid = valid; }
        boolean current() { return owner.get() != null && valid.getAsBoolean(); }
    }
    private final Map<String, Claim> claims = new HashMap<>();
    synchronized String acquire(String origin, String key, Object owner, BooleanSupplier valid) {
        String id = origin + '\0' + key; Claim prior = claims.get(id);
        if (prior != null && prior.current()) return null;
        claims.remove(id); if (!valid.getAsBoolean()) return null;
        Claim claim = new Claim(owner, valid); claims.put(id, claim); return claim.token;
    }
    synchronized boolean owns(String origin, String key, Object owner, String token) {
        String id = origin + '\0' + key; Claim claim = claims.get(id);
        if (claim == null || !claim.current()) { claims.remove(id); return false; }
        return claim.owner.get() == owner && claim.token.equals(token);
    }
    synchronized boolean release(String origin, String key, Object owner, String token) {
        String id = origin + '\0' + key; Claim claim = claims.get(id);
        if (claim == null || claim.owner.get() != owner || !claim.token.equals(token)) return false;
        claims.remove(id); return true;
    }
    synchronized void releaseAll(Object owner) {
        Iterator<Claim> items = claims.values().iterator();
        while (items.hasNext()) { Object held = items.next().owner.get(); if (held == null || held == owner) items.remove(); }
    }
}
