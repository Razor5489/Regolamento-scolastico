'use strict';
const {get,put,BlobPreconditionFailedError}=require('@vercel/blob');
const {validate}=require('./_shared.cjs');

const PATH='nightfall-regolamento/regolamento-scolastico.json';
const SEED='https://raw.githubusercontent.com/Razor5489/Regolamento-scolastico/main/regolamento.json';

function normalizeEtag(value){
 return typeof value==='string' && value ? value.replace(/^W\//,'') : null;
}
async function readStored(){
 const blob=await get(PATH,{access:'private',useCache:false});
 if(!blob || blob.statusCode!==200 || !blob.stream)return null;
 const source=await new Response(blob.stream).text();
 const document=JSON.parse(source);
 if(!validate(document))throw new Error('Il documento conservato non ha una struttura valida.');
 const sha=normalizeEtag(blob.blob?.etag);
 if(!sha)throw new Error('La versione del regolamento non è disponibile.');
 return {document,sha};
}
async function readDocument(){
 const current=await readStored();
 if(current)return current;
 // Primo utilizzo: importa la versione GitHub attualmente pubblicata.
 // In seguito le modifiche vengono conservate nell'archivio privato Vercel.
 const response=await fetch(SEED,{cache:'no-store'});
 if(!response.ok)throw new Error('Impossibile leggere la copia iniziale del regolamento.');
 const document=await response.json();
 if(!validate(document))throw new Error('Il documento iniziale non è valido.');
 try{
  const created=await put(PATH,JSON.stringify(document,null,2)+'\n',{
   access:'private',addRandomSuffix:false,allowOverwrite:false,
   contentType:'application/json; charset=utf-8',cacheControlMaxAge:60
  });
  const sha=normalizeEtag(created.etag);
  if(!sha)throw new Error('Non è stato possibile determinare la revisione iniziale.');
  return {document,sha};
 }catch(error){
  const concurrent=await readStored();
  if(concurrent)return concurrent;
  throw error;
 }
}
async function saveDocument(document,expectedSha){
 if(!validate(document))return {error:'Il documento contiene dati non validi.',status:400};
 const sha=normalizeEtag(expectedSha);
 if(!sha || sha.length>200)return {error:'Versione del documento non valida.',status:400};
 try{
  const saved=await put(PATH,JSON.stringify(document,null,2)+'\n',{
   access:'private',addRandomSuffix:false,allowOverwrite:true,ifMatch:sha,
   contentType:'application/json; charset=utf-8',cacheControlMaxAge:60
  });
  return {sha:normalizeEtag(saved.etag)};
 }catch(error){
  if(error instanceof BlobPreconditionFailedError || /Precondition failed|ETag mismatch|not match/i.test(String(error?.message||''))){
   return {error:'Il regolamento è stato modificato da un’altra persona. Esporta la bozza e ricarica il sito.',status:409};
  }
  throw error;
 }
}
module.exports={readDocument,saveDocument};
