package com.reylumi.android;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import static org.junit.Assert.*;

/** Run with -e portablePersistencePhase prepare, force-stop target, then verify.
 * The fixture uses its own no-backup directory and Keystore alias, never POS data. */
@RunWith(AndroidJUnit4.class)
public class PortableColdStartTest {
    @Test public void synchronousAcknowledgementSurvivesSeparateInstrumentationProcesses()throws Exception{
        String phase=InstrumentationRegistry.getArguments().getString("portablePersistencePhase","single");
        File directory=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"portable-cold-start-fixture-v1");
        String scope="10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001",key="kingpos:portable-draft:v1:"+scope+":native",id="30000000-0000-4000-8000-000000000001";
        PortableStore store=new PortableStore(directory,NavigationPolicy.appOrigin());
        try{
            if(!phase.equals("verify")){
                store.set(key,"{\"savedAt\":1,\"customer\":\"Synthetic cold restart fixture\"}",scope);
                store.save(new JSONObject().put("id",id).put("scope",scope).put("kind","receipt").put("occurredAt","2026-11-18T12:00:00Z").put("state","pending").put("payload",new JSONObject().put("localDraftKey",key).put("total",37.5)),scope,false,null);
            }
            assertTrue(store.get(key,scope).contains("Synthetic cold restart fixture"));assertEquals(1,store.list(scope).length());assertEquals(id,store.list(scope).getJSONObject(0).getString("id"));assertTrue(store.checkpoint(scope,key)>0);
        }finally{store.close();}
    }
}
