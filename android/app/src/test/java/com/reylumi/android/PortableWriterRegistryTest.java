package com.reylumi.android;

import org.junit.Test;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public class PortableWriterRegistryTest {
    @Test public void aLivingWriterCannotBeStolenAndExactTokenReleaseCannotEvictItsSuccessor(){
        PortableWriterRegistry registry=new PortableWriterRegistry();Object first=new Object(),second=new Object();
        String token=registry.acquire("origin","draft",first,()->true);assertNotNull(token);
        assertNull(registry.acquire("origin","draft",second,()->true));
        assertFalse(registry.release("origin","draft",second,token));assertFalse(registry.release("origin","draft",first,"wrong"));
        assertTrue(registry.release("origin","draft",first,token));String next=registry.acquire("origin","draft",second,()->true);assertNotNull(next);
        assertFalse(registry.release("origin","draft",first,token));assertTrue(registry.owns("origin","draft",second,next));
    }
    @Test public void documentRevocationFencesOldClaimsAndOriginsRemainSeparate(){
        PortableWriterRegistry registry=new PortableWriterRegistry();Object first=new Object(),second=new Object();AtomicBoolean admitted=new AtomicBoolean(true);
        String token=registry.acquire("one","draft",first,admitted::get);assertNotNull(token);
        assertNotNull(registry.acquire("two","draft",second,()->true));admitted.set(false);
        assertFalse(registry.owns("one","draft",first,token));String replacement=registry.acquire("one","draft",second,()->true);assertNotNull(replacement);
        registry.releaseAll(first);assertTrue(registry.owns("one","draft",second,replacement));registry.releaseAll(second);assertFalse(registry.owns("one","draft",second,replacement));
    }
    @Test public void strictUuidNamespacesRejectPrefixSiblingsAndForeignPOSKeys(){
        String scope="00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003";
        assertTrue(PortableStore.validScope(scope));assertFalse(PortableStore.validScope("1-1-1-1-1:1-1-1-1-1"));
        assertTrue(PortableStore.validKey("kingpos:portable-draft:v1:"+scope+":native",scope));
        assertFalse(PortableStore.validKey("kingpos:portable-draft:v1:"+scope+"1",scope));
        assertFalse(PortableStore.validKey("kingpos:portable-draft:v1:"+scope+":native\n",scope));assertFalse(PortableStore.validKey("authentication",scope));
    }
}
