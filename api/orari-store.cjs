'use strict';
const {get,put,BlobPreconditionFailedError}=require('@vercel/blob');

const PATH='nightfall-orari/orari.json';
const SEED='https://raw.githubusercontent.com/Razor5489/ORARIO-LEZIONI-NIGHTFALL/main/orari.json';

async function loadSaved(){
  const result=await get(PATH,{access:'private',useCache:false});
  if(!result || result.statusCode!==200 || !result.stream)return null;
  const source=await new Response(result.stream).text();
  const document=JSON.parse(source);
  // For compressed JSON, Blob get() may expose a weak HTTP ETag (W/"…").
  // Conditional put(ifMatch) requires the strong/origin ETag, otherwise even
  // a single save fails with a spurious precondition error.
  const rawEtag=result.blob?.etag;
  const sha=typeof rawEtag==='string'?rawEtag.replace(/^W\//,''):null;
  if(typeof sha!=='string'||!sha)throw Error('L’archivio non ha una versione verificabile.');
  return {document,sha};
}
async function readSchedule(){
  const found=await loadSaved();
  if(found)return found;
  // Initialize once from the public, read-only GitHub data.
  const r=await fetch(SEED,{cache:'no-store'});
  if(!r.ok)throw Error('Non è stato possibile inizializzare gli orari dal repository pubblico.');
  const text=await r.text();
  const seed=JSON.parse(text);
  if(!seed.schedules||!seed.teachers)throw Error('I dati iniziali non sono validi.');
  try{
    const uploaded=await put(PATH,JSON.stringify(seed,null,2)+'\n',{
      access:'private',
      addRandomSuffix:false,
      allowOverwrite:false,
      contentType:'application/json; charset=utf-8',
      cacheControlMaxAge:60
    });
    return {document:seed,sha:uploaded.etag};
  }catch(error){
    // A simultaneous initial request may already have created this file.
    const concurrent=await loadSaved();
    if(concurrent)return concurrent;
    throw error;
  }
}
async function writeSchedule(doc,expectedSha){
  try{
    const saved=await put(PATH,JSON.stringify(doc,null,2)+'\n',{
      access:'private',
      addRandomSuffix:false,
      allowOverwrite:true,
      ifMatch:typeof expectedSha==='string'?expectedSha.replace(/^W\//,''):expectedSha,
      contentType:'application/json; charset=utf-8',
      cacheControlMaxAge:60
    });
    return {sha:saved.etag};
  }catch(error){
    if(error instanceof BlobPreconditionFailedError){
      return {error:'Gli orari sono stati modificati nel frattempo. Scarica il backup della tua bozza e ricarica la pagina.',status:409};
    }
    throw error;
  }
}
module.exports={readSchedule,writeSchedule};
