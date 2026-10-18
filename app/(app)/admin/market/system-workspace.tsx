import {notFound} from 'next/navigation';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/lib/platform-admin/permissions';
import {marketPaymentSettings,marketServiceClient} from '@/lib/market-payments';
import {paymentConfig,publicPayment,PAYMENT_WEBHOOK} from '@/lib/platform-payment';
import {getTwilioSettings,publicTwilioSettings} from '@/lib/twilio-settings';
import {getSupportEmailConfig,publicSupportEmailConfig} from '@/lib/support-email';
import {cardMoney,CARD_PLUGINS} from '@/lib/market-card-rules';
import {loadMarketTaxAdminState} from '@/lib/market-tax';
import Link from 'next/link';
import {AdminPageHeader} from '../_components/admin-ui';
import {AdminActionForm} from '../_components/action-form';
import {loadMarketBillingAdminState} from './billing-data';
import {saveMarketBillingCatalog,saveMarketBillingSettings} from './billing-actions';
import {saveMarketPluginOperations} from './plugin-operations-actions';
import {saveSupportEmailSettingsAction} from '../settings/support-email/actions';
import {TwilioSettingsForm} from '../settings/twilio/settings-form';
import {Orders,Ledger} from './billing-workspace';
import {SystemRow} from './system-row';
import {savePaymentConnection,reconcileCardPayment,retryCardEvent,refundCardInvoice} from './system-actions';
import type {ReactNode} from 'react';
import './system.css';
function Field({label,children}:{label:string;children:ReactNode}){return <label className="system-field"><span>{label}</span>{children}</label>;}
function Save({label='Save changes'}:{label?:string}){return <div className="system-actions"><button className="system-primary">{label}</button></div>;}
function Failure(){return <p role="alert" className="system-note system-error">Could not load this section. Refresh before making changes.</p>;}
export async function MarketSystemWorkspace({section='system'}:{section?:'plugins'|'system'}={}){
 const actor=await requirePlatformAdmin(P.teamManage);if(actor.roleSlug!=='platform_owner')notFound();
 const client=marketServiceClient();
 const [billingResult,paymentResult,twilioResult,emailResult,operationsResult,purchasesResult,eventsResult,invoicesResult,auditResult,taxResult]=await Promise.allSettled([
 loadMarketBillingAdminState(),paymentConfig(),getTwilioSettings(),getSupportEmailConfig(),marketPaymentSettings(),
 client.from('market_card_purchases').select('id,plugin_id,amount_cents,status,paid_until,last_error,created_at,subscription_id').order('created_at',{ascending:false}).limit(100),
 client.from('market_card_events').select('id,type,status,attempts,last_error,created_at').order('created_at',{ascending:false}).limit(100),
 client.from('market_card_invoices').select('id,purchase_id,amount_cents,refunded_cents,status,period_end').order('updated_at',{ascending:false}).limit(100),
 client.from('market_system_audit').select('id,action,created_at').order('created_at',{ascending:false}).limit(25),loadMarketTaxAdminState()
 ]);
 const billing=billingResult.status==='fulfilled'?billingResult.value:null;
 const payment=paymentResult.status==='fulfilled'?publicPayment(paymentResult.value):null;
 const twilio=twilioResult.status==='fulfilled'?publicTwilioSettings(twilioResult.value):null;
 const email=emailResult.status==='fulfilled'?publicSupportEmailConfig(emailResult.value):null;
 const operations=operationsResult.status==='fulfilled'?operationsResult.value:null;
 const purchases=purchasesResult.status==='fulfilled'&&!purchasesResult.value.error?purchasesResult.value.data:null;
 const events=eventsResult.status==='fulfilled'&&!eventsResult.value.error?eventsResult.value.data:null;
 const invoices=invoicesResult.status==='fulfilled'&&!invoicesResult.value.error?invoicesResult.value.data:null;
 const audit=auditResult.status==='fulfilled'&&!auditResult.value.error?auditResult.value.data:null;
 const tax=taxResult.status==='fulfilled'?taxResult.value:null;
 return <div className="market-system"><AdminPageHeader eyebrow="" title={section==='plugins'?'Plugins':'System'} />
 {section==='system'&&<><h2 className="system-group">Shared configuration</h2>
 <SystemRow id="payment" name="Payment" value={payment?.keyConfigured?`Stripe · ${payment.mode} · USD`:'Stripe · connection required'} scope={payment?.enabled?'Live purchases enabled':'Purchases paused'} open>
 {payment?<AdminActionForm action={savePaymentConnection} className="system-form">
 <input type="hidden" name="version" value={payment.version}/>
 <Field label="Stripe API key"><input type="password" name="secret_key" autoComplete="new-password" placeholder={payment.keyConfigured?'Configured — leave blank to keep':'sk_live_… or rk_live_…'}/></Field>
 <Field label="Publishable key"><input name="publishable_key" defaultValue={payment.publishableKey} autoComplete="off" placeholder="pk_live_… or pk_test_…"/></Field>
 <Field label="Accept new card purchases"><input type="checkbox" name="enabled" defaultChecked={payment.enabled}/></Field>
 <div className="system-field"><span>Provider webhook</span><span className="system-inherited">{payment.webhookConfigured?'Configured':'Created automatically when you save'}</span></div>
 <div className="system-field"><span>Endpoint</span><span className="system-inherited" style={{overflowWrap:'anywhere'}}>{PAYMENT_WEBHOOK}</span></div>
 <div className="system-field"><span>Plugin payments</span><span>Reylumi · card · monthly renewal</span></div>
 <div className="system-field"><span>Appointment payments</span><span>Salon connected account · separate funds</span></div>
 <p className="system-note">Accepts standard (sk_) or restricted (rk_) API keys with a publishable key from the same account and mode. Saved credentials stay hidden. Test mode never enables customer purchases. Pausing purchases preserves existing renewals and refunds.</p>
 <details><summary className="system-note">Permissions for restricted keys</summary><p className="system-note">Read: Account, Events, Invoices, Payment Intents, Charges, Tax settings and registrations, Tax rates and codes. Stripe may group Tax codes under Quotes.</p><p className="system-note">Write: Checkout Sessions, Subscriptions, Charges and Refunds, Credit Notes, Customer Portal and Webhook Endpoints. Shared Campaigns payments also need Payment Intents write access. Follow Stripe’s dependency prompts for Customers, Products and Prices.</p></details>
 <div className="system-actions"><button className="system-primary" name="intent" value="save">Save connection</button><button name="intent" value="test">Check connection</button></div>
 </AdminActionForm>:<Failure/>}
 {billing&&<details><summary className="system-note">Transaction fees and fixed tax fallback</summary><AdminActionForm action={saveMarketBillingSettings} className="system-form">
 <input type="hidden" name="version" value={billing.settings.version}/><input type="hidden" name="default_bank_account_id" value={billing.settings.default_bank_account_id??''}/><input type="hidden" name="order_expiry_hours" value={billing.settings.order_expiry_hours}/>
 <Field label="Tax label"><input name="tax_label" defaultValue={billing.settings.tax_label} required/></Field>
 <Field label="Fixed tax (%) — only when automatic tax is off"><input type="number" name="tax" defaultValue={billing.settings.tax_bps/100} min="0" max="100" step="0.01" required/></Field>
 <Field label="Transaction fee (%)"><input type="number" name="fee" defaultValue={billing.settings.fee_bps/100} min="0" max="100" step="0.01" required/></Field>
 <Field label="Fixed fee (USD)"><input type="number" name="fixed" defaultValue={billing.settings.fixed_fee_cents/100} min="0" max="1000000" step="0.01" required/></Field>
 <p className="system-note">New subscriptions use these fees. Automatic tax replaces the fixed tax rate and calculates tax on the plugin price plus fees. Keep fixed tax at zero until your collection obligations are confirmed. Existing subscriptions keep their saved terms.</p><Save label="Save fees and fallback"/>
 </AdminActionForm></details>}
 </SystemRow>
 <SystemRow id="tax" name="Automatic tax" value="Stripe Tax" scope={tax?.settings.enabled?'Enabled for new plugin subscriptions':'Setup required / paused'}>
 <p className="system-note">Classify each plugin, check your registrations, and track collected tax and tax credits by jurisdiction. Nationwide US sales use the customer location and product classification.</p>
 {tax&&<div className="system-field"><span>Provider readiness</span><span>{tax.provider.status==='active'?`${tax.provider.mode} · ${tax.provider.registrations.filter(r=>r.status==='active').length} active registrations`:'Complete the Stripe connection and tax setup'}</span></div>}
 <div className="system-actions"><Link className="system-primary" href="/admin/market/tax">Manage tax & reports</Link></div>
 </SystemRow>
 <SystemRow id="messaging" name="System SMS & verification" value="Twilio" scope={twilio?.tokenConfigured?'Configured':'Connection required'}>{twilio?<div className="system-legacy"><TwilioSettingsForm settings={twilio}/></div>:<Failure/>}</SystemRow>
 <SystemRow id="email" name="Support email" value={email?.from??'Resend'} scope={email?.enabled&&email.keyConfigured?'Configured':'Disabled'}>{email?<AdminActionForm action={saveSupportEmailSettingsAction} className="system-form"><Field label="Sender"><input type="email" name="from" defaultValue={email.from} required/></Field><Field label="Resend API key"><input type="password" name="api_key" autoComplete="new-password" placeholder={email.keyConfigured?'Configured — leave blank to keep':'Resend API key'}/></Field><Field label="Direct support replies"><input type="checkbox" name="enabled" defaultChecked={email.enabled&&email.keyConfigured}/></Field><p className="system-note">Domain verification is required. Replies arrive in the support mailbox.</p><div className="system-actions"><button className="system-primary" name="intent" value="save">Save email</button><button name="intent" value="test">Check connection</button></div></AdminActionForm>:<Failure/>}</SystemRow>
 </>}{section==='plugins'&&<><h2 className="system-group">Plugins</h2>
 {!billing&&<Failure/>}
 {billing?.catalog.map(item=><SystemRow key={`${item.plugin_id}-${item.version}`} id={`plugin-${item.plugin_id}`} name={item.name} value={`${cardMoney(item.price_cents)} / month`} scope={!item.published?'Hidden':CARD_PLUGINS.some(id=>id===item.plugin_id)&&item.fulfillment_ready?'Published':'Preview'}>
 <AdminActionForm action={saveMarketBillingCatalog} className="system-form"><input type="hidden" name="plugin_id" value={item.plugin_id}/><input type="hidden" name="version" value={item.version}/>
 <Field label="Monthly price (USD)"><input name="price" type="number" min="0.50" max="1000000" step="0.01" defaultValue={item.price_cents/100} required/></Field>
 {item.plugin_id==='booksms'&&<><Field label="Monthly SMS allowance"><input name="monthly_sms_limit" type="number" min="0" max="1000000" step="1" defaultValue={item.monthly_sms_limit??0} required/></Field><Field label="Fulfillment ready"><input name="fulfillment_ready" type="checkbox" defaultChecked={item.fulfillment_ready}/></Field></>}
 <Field label="Visible in Market"><input name="published" type="checkbox" defaultChecked={item.published}/></Field>
 <Field label="Publisher commission (%)"><input name="commission" type="number" min="0" max="100" step="0.01" defaultValue={item.commission_bps/100} required/></Field>
 <div className="system-field"><span>Payment / currency</span><span>Stripe / USD <small className="system-inherited"> · Shared</small></span></div><div className="system-field"><span>Tax / fees</span><span>{tax?.settings.enabled?'Automatic tax':`${billing.settings.tax_bps/100}% fixed tax`} / {billing.settings.fee_bps/100}% + {cardMoney(billing.settings.fixed_fee_cents)} <small className="system-inherited"> · Shared</small></span></div>
 <p className="system-note">Price changes apply to new subscriptions. Existing paid periods and renewals retain their original terms.</p><Save label="Save plugin"/></AdminActionForm>
 {item.plugin_id==='booking-deposit'&&operations&&<AdminActionForm action={saveMarketPluginOperations} className="system-form"><hr/><div className="system-field"><span>Appointment charge recipient</span><span>Salon connected account</span></div><Field label="Allow deposit testing"><input type="checkbox" name="booking_deposit_test_enabled" defaultChecked={operations.booking_deposit_test_enabled}/></Field><p className="system-note">Test bookings are real appointments without a money charge. Each salon controls its deposit amount.</p><Save label="Save testing policy"/></AdminActionForm>}
 </SystemRow>)}
 <Link className="system-plugin-link" href="/admin/plugins/campaigns"><strong>Campaigns</strong><span>120 credits = $1</span><span aria-hidden="true">→</span></Link>
 <SystemRow id="plugin-payroll-data-download" name="Payroll Data Download" value="Free" scope="Available"><p className="system-note">Free access. No payment configuration required.</p></SystemRow>
 <SystemRow id="plugin-service-relay" name="Phone Checkin" value="Existing access" scope="Billing review"><p className="system-note">Existing installation is preserved. Card sales remain disabled until paid access is connected.</p></SystemRow>
 </>}{section==='system'&&<><h2 className="system-group">Operations</h2>
 <SystemRow id="transactions" name="Card transactions" value={purchases?`${purchases.length} recent subscriptions`:'Unavailable'} scope="Payments & access">{purchases?<div>{!purchases.length&&<p className="system-note">No card subscriptions yet.</p>}{purchases.map(row=><details key={row.id} className="system-row"><summary><span>{billing?.catalog.find(c=>c.plugin_id===row.plugin_id)?.name??row.plugin_id}</span><span>{cardMoney(row.amount_cents)} · {row.status}</span><span>{row.paid_until?'Access recorded':'No paid access'}</span></summary><div className="system-row-body"><p className="system-note">{row.id} · {new Date(row.created_at).toISOString()}</p><AdminActionForm action={reconcileCardPayment}><input type="hidden" name="purchase_id" value={row.id}/><button>Reconcile payment & access</button></AdminActionForm><p className="system-note">Reads provider state and retries activation. Does not charge again.</p>{invoices?.filter(invoice=>invoice.purchase_id===row.id).map(invoice=><details key={invoice.id}><summary className="system-note">{invoice.id} · {cardMoney(invoice.amount_cents)} · {invoice.status}</summary>{invoice.status==='paid'&&<AdminActionForm action={refundCardInvoice} className="system-form" confirmMessage="Refund this full invoice to its original card and cancel future renewal? This sends a real refund."><input type="hidden" name="invoice_id" value={invoice.id}/><Field label="Refund reason"><input name="reason" minLength={3} maxLength={500} required/></Field><Save label="Refund invoice & cancel renewal"/></AdminActionForm>}</details>)}</div></details>)}</div>:<Failure/>}</SystemRow>
 <SystemRow id="events" name="Payment events" value={events?`${events.filter(e=>e.status==='failed').length} need attention`:'Unavailable'} scope="Webhook & retry">{events?<div className="system-scroll"><table className="system-table"><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Action</th></tr></thead><tbody>{events.map(event=><tr key={event.id}><td>{event.type}<br/><small>{event.id}</small></td><td>{event.status}</td><td>{event.attempts}</td><td>{event.status!=='processed'&&<AdminActionForm action={retryCardEvent}><input type="hidden" name="event_id" value={event.id}/><button>Retry</button></AdminActionForm>}</td></tr>)}</tbody></table>{!events.length&&<p className="system-note">No payment events yet.</p>}</div>:<Failure/>}</SystemRow>
 <SystemRow id="bank-history" name="Earlier bank payments" value="Receipts & refunds" scope="Historical orders">{billing?<div className="system-legacy"><Orders state={billing}/></div>:<Failure/>}</SystemRow>
 <SystemRow id="ledger" name="Bank ledger" value="Income & expenses" scope="Historical ledger">{billing?<div className="system-legacy"><Ledger state={billing}/></div>:<Failure/>}</SystemRow>
 <SystemRow id="audit" name="Configuration history" value="Owner access required" scope="Audit">{audit?<div className="system-scroll"><table className="system-table"><thead><tr><th>Time</th><th>Action</th></tr></thead><tbody>{audit.map(row=><tr key={row.id}><td>{row.created_at}</td><td>{row.action}</td></tr>)}</tbody></table></div>:<Failure/>}</SystemRow>
 </>}</div>;
}
