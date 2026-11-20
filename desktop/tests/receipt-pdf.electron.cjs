'use strict';
// Renderer proof only: never calls webContents.print or a printer spooler.
const{app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const input=process.env.RECEIPT_RENDER_INPUT,output=process.env.RECEIPT_RENDER_OUTPUT,profile=process.env.RECEIPT_RENDER_PROFILE;
if(!input||!output||!profile||!path.isAbsolute(input)||!path.isAbsolute(output)||!path.isAbsolute(profile))throw Error('Explicit isolated receipt renderer paths required');
app.setPath('userData',profile);app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 fs.mkdirSync(output,{recursive:true});const rows=[];
 for(const paper of['58mm','80mm','a4']){
  const width=paper==='58mm'?240:paper==='80mm'?320:840;
  const win=new BrowserWindow({show:false,width,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false,partition:'receipt-render-'+paper}});
  win.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','file://*/*']},(_r,callback)=>callback({cancel:true}));
  try{
   await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(fs.readFileSync(path.join(input,'receipt-'+paper+'.html'),'utf8')));
   const pdf=await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
   fs.writeFileSync(path.join(output,'receipt-'+paper+'.pdf'),pdf);
   rows.push({paper,bytes:pdf.length,source:'same shared isolated HTML',osPrintDialogOpened:false,spoolerCalled:false});
  }finally{win.destroy();}
 }
 const result={status:'passed',electron:process.versions.electron,chromium:process.versions.chrome,rows,installedPortableModified:false,nativePrinterOrDialogAcceptance:false};
 fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.quit();
}).catch(error=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'FAILURE.json'),JSON.stringify({error:error.message}));console.error(error.message);app.exit(1)});
