"use client";
import { CustomerJourney, CustomerJourneyLoading, type CustomerJourneyProps } from "./customer-journey";
export function CustomerActivityView(props:CustomerJourneyProps) { return <CustomerJourney {...props}/>; }
export function CustomerActivityError({message}:{message:string}) { return <CustomerJourneyLoading failed={message} onRetry={()=>window.location.reload()}/>; }
