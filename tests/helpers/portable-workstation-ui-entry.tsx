import React from 'react';
import { createRoot } from 'react-dom/client';
import { PosDeskClient } from '@/app/pos/pos-desk-client';
import { PairedCustomerDisplay } from '@/app/pos/customer-display/paired-customer-display';
import { PortableWorkspaceStateProvider } from '@/app/pos/portable/portable-workspace-state';
import { workstationRequest } from '@/lib/portable-workstation-client';

const staff = [{ id: '00000000-0000-4000-8000-000000000500', display_name: 'Anna', job_title: 'Specialist', is_active: true, avatar_url: null, today_status: 'working', check_in_at: new Date().toISOString(), check_in_sequence: 1, turns: { largeTurns: 0, queueTurns: 0, receiptLargeTurns: 0, smallTurns: 0, totalTurns: 0 } }];
const root = createRoot(document.getElementById('root')!);
const read = async () => ({ ok: true, data: await fetch('/__fixture/draft').then(response => response.json()) });
Object.assign(window, { fixture: { request: workstationRequest } });
async function mount() {
  const session = await workstationRequest();
  if (session.role === 'customer') { root.render(<PairedCustomerDisplay session={session} />); return; }
  const snapshot = (await read()).data;
  root.render(<PortableWorkspaceStateProvider scope="00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000010" preparedAt={Date.now()} timezone="America/Chicago" offlineEnabled>
    <PosDeskClient pairedWorkstation offlineDraftSyncEnabled surface="portable" activeSession={null} salonName="Isolated fixture salon" services={[]} staff={staff as never} today={new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())} liveDraft={snapshot}
      actions={{ getPosLiveDraft: read, getCustomerDisplayLiveDraftTipOptions: async () => ({ ok: true, data: [] }), submitPosDeskReceipt: async () => { throw Error('This UI test must never Submit a receipt.'); } } as never}
      defaults={{ adsFooter: '', largeTurnThreshold: 25, showServiceName: true, showStaffName: true, staffCheckInEnabled: false, taxEnabled: false, tipSuggestions: [10, 15, 20] }} />
  </PortableWorkspaceStateProvider>);
}
void mount().catch(error => { document.getElementById('root')!.textContent = error.message; });
