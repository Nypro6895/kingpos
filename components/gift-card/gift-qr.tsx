"use client";
import { QrCodeTile } from "@/components/qr-code-tile";
export function GiftQr({value,label}:{value:string;label:string}){return <QrCodeTile valueToEncode={value} ariaLabel={label} fallbackMessage="Open the link or ask staff to enter your card code."/>;}
