'use strict';
const {get,put,BlobPreconditionFailedError}=require('@vercel/blob');

const PATH='nightfall-regolamento/clubs-page.json';
const PUBLIC_SEED='https://raw.githubusercontent.com/Razor5489/Regolamento-scolastico/main/regolamento.json';

function validateClubsPage(doc){
 if(!doc||doc.version!==1||!doc.texts||typeof doc.texts!=='object'||Array.isArray(doc.texts)||
    !doc.meta||typeof doc.meta!=='object'||Array.isArray(doc.meta))return false;
 if(typeof doc.meta.title!=='string'||doc.meta.title.length>220||
    typeof doc.meta.description!=='string'||doc.meta.description.length>600)return false;
 const entries=Object.entries(doc.texts);
 if(entries.length>2000||entries.some(([key,value])=> !/^t\d{4}$/.test(key) ||
     typeof value!=='string'||value.length>10000))return false;
 return Buffer.byteLength(JSON.stringify(doc),'utf8')<=400000;
}
function strongEtag(tag){return typeof tag==='string'?tag.replace(/^W\//,''):null;}
async function readExisting(){
 const result=await get(PATH,{access:'private',useCache:false});
 if(!result||result.statusCode!==200||!result.stream)return null;
 const text=await new Response(result.stream).text();
 const document=JSON.parse(text);
 if(!validateClubsPage(document))throw Error('Contenuti Club non validi nell’archivio.');
 const sha=strongEtag(result.blob?.etag);
 if(!sha)throw Error('Versione archivio Club mancante.');
 return {document,sha};
}
async function readClubs(){
 const stored=await readExisting();
 if(stored)return stored;
 // Primo avvio: importa le modifiche già pubblicate nel regolamento.json
 // senza cancellare o sovrascrivere i nomi dei fondatori presenti.
 const res=await fetch(PUBLIC_SEED,{cache:'no-store'});
 if(!res.ok)throw Error('Importazione iniziale dei Club non disponibile.');
 const existing=await res.json();
 const seed=existing.clubsPage || {
  version:1,texts:{},
  meta:{
   title:'Club Scolastici di Hogwarts | Nightfall RP',
   description:'Portale ufficiale dei Club Scolastici di Hogwarts — Nightfall RP.'
  }
 };
 if(!validateClubsPage(seed))throw Error('Contenuti iniziali del Club non validi.');
 try {
  const created=await put(PATH,JSON.stringify(seed,null,2)+'\n',{
   access:'private',addRandomSuffix:false,allowOverwrite:false,
   contentType:'application/json; charset=utf-8',cacheControlMaxAge:60
  });
  return {document:seed,sha:strongEtag(created.etag)};
 }catch(error){
  const concurrent=await readExisting();
  if(concurrent)return concurrent;
  throw error;
 }
}
async function writeClubs(document,expectedSha){
 if(!validateClubsPage(document))return {error:'Testi della pagina non validi.',status:400};
 try {
  const uploaded=await put(PATH,JSON.stringify(document,null,2)+'\n',{
   access:'private',addRandomSuffix:false,allowOverwrite:true,
   ifMatch:strongEtag(expectedSha),
   contentType:'application/json; charset=utf-8',cacheControlMaxAge:60
  });
  return {sha:strongEtag(uploaded.etag)};
 }catch(error){
  if(error instanceof BlobPreconditionFailedError || 
     /Precondition failed|ETag mismatch|not match/i.test(String(error?.message||'')))
   return {error:'Qualcun altro ha pubblicato nuove modifiche. Ricarica la pagina e riprova.',status:409};
  throw error;
 }
}
module.exports={readClubs,writeClubs,validateClubsPage};
