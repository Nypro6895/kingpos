import React from 'react';
import { createRoot } from 'react-dom/client';
import { MembershipAdmin } from '../../app/(app)/admin/membership/workspace';
import { MembershipWebsite } from '../../app/(legal)/membership/website';
async function start(){const publicPage=location.pathname==='/membership';const url=publicPage?'/public-data':'/admin-data';const data=await(await fetch(url)).json();const copy=publicPage?await(await fetch('/website-copy')).json():undefined;createRoot(document.getElementById('root')!).render(publicPage?<MembershipWebsite plans={data} copy={copy??undefined}/>:<div className="admin-workspace"><MembershipAdmin initial={data} canConfigure={!location.search.includes('readonly')} canManage={!location.search.includes('readonly')}/></div>);}
void start();
