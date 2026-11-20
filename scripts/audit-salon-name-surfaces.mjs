import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const canonical='C:/Reylumi/kingpos';
const config=ts.readConfigFile(path.join(canonical,'tsconfig.json'),ts.sys.readFile).config;
const parsed=ts.parseJsonConfigFileContent(config,ts.sys,canonical);
const roots=parsed.fileNames.filter(f=>/\/(app|components)\//.test(f.replaceAll('\\','/'))&&f.endsWith('.tsx'));
const program=ts.createProgram(roots,{...parsed.options,incremental:false});
const checker=program.getTypeChecker();
const rows=[];
const otherNames=[];
const attributes=[];
for(const source of program.getSourceFiles()){
 const file=path.relative(canonical,source.fileName).replaceAll('\\','/');
 if(!/^(app|components)\//.test(file)||!file.endsWith('.tsx'))continue;
 function visit(node){
  if(ts.isJsxAttribute(node)&&['name','title','label'].includes(node.name.text)&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression){const value=node.initializer.expression.getText(source);if(/salonName|salon_name|(?:profile|salon|location)\??\.name/i.test(value))attributes.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,tag:node.parent.parent.tagName.getText(source),attribute:node.name.text,value});}
  if(ts.isJsxExpression(node)&&node.expression&&(ts.isJsxElement(node.parent)||ts.isJsxFragment(node.parent))){
   const expr=node.expression,text=expr.getText(source);
   const prop=ts.isPropertyAccessExpression(expr)?expr.name.text:null;
   if(prop==='name') otherNames.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,name:text,type:checker.typeToString(checker.getTypeAtLocation(expr.expression)).slice(0,180)});
   const objectType=ts.isPropertyAccessExpression(expr)?checker.getNonNullableType(checker.getTypeAtLocation(expr.expression)):null;
   const domainSalon=objectType&&/^(PublicSalonProfile|CustomerActivitySalon|ExploreFeedSalonContext|Location|BusinessRow|BusinessReview|BusinessClaimMatch)(?:\s|$|&)/.test(checker.typeToString(objectType));
   const isName=prop==='salonName'||prop==='salon_name'||(prop==='name'&&(/^(salon|selectedSalon|location)$/.test(expr.expression.getText(source))||objectType?.getProperty('salonId')||domainSalon))||/^(salonName|currentManageSalonName|currentStaffSalonName)$/.test(text);
   if(isName){
    let id=null,via=null;
    if(ts.isPropertyAccessExpression(expr)){
     const obj=expr.expression,typ=checker.getNonNullableType(checker.getTypeAtLocation(obj)),base=obj.getText(source);
     const key=['salonId','salon_id','location_id',...((domainSalon||/^(salon|selectedSalon|location)$/.test(base))?['id']:[])].find(k=>typ.getProperty(k));
     if(key){id=`${base}.${key}`;via='object';}
    }
    const symbols=checker.getSymbolsInScope(node,ts.SymbolFlags.Value);
    if(!id){const preferred=text.startsWith('current')?text.replace(/Name$/,'Id'):'salonId';if(symbols.some(s=>s.name===preferred)){id=preferred;via='scope';}}
    let parent=node.parent;
    while(parent&& !ts.isFunctionLike(parent)){
     if(ts.isJsxElement(parent)&&['a','Link'].includes(parent.openingElement.tagName.getText(source))){
      const attr=parent.openingElement.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.text==='href');
      if(attr?.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression){const href=attr.initializer.expression.getText(source);if(!id&&/salon|profile|href/i.test(href)){id=href;via='href';}}break;
     }parent=parent.parent;
    }
    rows.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,start:node.getStart(),end:node.end,name:text,id,via,...(!id?{properties:ts.isPropertyAccessExpression(expr)?checker.getTypeAtLocation(expr.expression).getProperties().map(p=>p.name):[],scope:symbols.filter(s=>s.declarations?.some(d=>d.getSourceFile()===source)&&/salon|data|context|token|session|entry|receipt|preview|invite|dashboard/i.test(s.name)).map(s=>s.name)}:{})});
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
}
fs.mkdirSync('artifacts/member-everywhere',{recursive:true});fs.writeFileSync('artifacts/member-everywhere/inventory.json',JSON.stringify(rows,null,2));
fs.writeFileSync('artifacts/member-everywhere/other-names.json',JSON.stringify(otherNames,null,2));
fs.writeFileSync('artifacts/member-everywhere/name-attributes.json',JSON.stringify(attributes,null,2));
console.log(JSON.stringify({total:rows.length,resolved:rows.filter(x=>x.id).length,unresolved:rows.filter(x=>!x.id).map(({file,line,name})=>({file,line,name}))},null,2));
