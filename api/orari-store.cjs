'use strict';
const {get,put,BlobPreconditionFailedError}=require('@vercel/blob');

const PATH='nightfall-orari/orari.json';
const SCORE_HOUSES=['grifondoro','tassorosso','corvonero','serpeverde'];
function normalizeScores(document){
  if(!document || typeof document!=='object')return document;
  const existing=document.points && typeof document.points==='object'?document.points:{};
  document.points=Object.fromEntries(SCORE_HOUSES.map(house=>[
    house, Number.isSafeInteger(existing[house]) ? existing[house] : 0
  ]));
  return document;
}
// Legacy documents have no lesson history; initialize it on read without
// changing timetable, points or teacher records.
function normalizeLessonLog(document){
  if(!document || typeof document!=='object')return document;
  if(!document.lessons_done || typeof document.lessons_done!=='object' ||
     Array.isArray(document.lessons_done))document.lessons_done={};
  return document;
}
// Direzione scolastica: migration for old archives without these fields.
function normalizeLeadership(document){
  if(!document || typeof document!=='object')return document;
  const existing=document.leadership && typeof document.leadership==='object' &&
    !Array.isArray(document.leadership)?document.leadership:{};
  document.leadership={
    preside:typeof existing.preside==='string'?existing.preside:'Lucian Sharp',
    vicepreside:typeof existing.vicepreside==='string'?existing.vicepreside:''
  };
  return document;
}
const SEED='https://raw.githubusercontent.com/Razor5489/ORARIO-LEZIONI-NIGHTFALL/main/orari.json';

async function loadSaved(){
  const result=await get(PATH,{access:'private',useCache:false});
  if(!result || result.statusCode!==200 || !result.stream)return null;
  const source=await new Response(result.stream).text();
  const document=normalizeLeadership(normalizeLessonLog(normalizeScores(JSON.parse(source))));
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
  const seed=normalizeLeadership(normalizeLessonLog(normalizeScores(JSON.parse(text))));
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
    if(error instanceof BlobPreconditionFailedError ||
       /Precondition failed|ETag mismatch/i.test(String(error?.message||''))){
      // The caller re-reads the latest schedule, reapplies only the submitted
      // changes and retries. The browser is not interrupted by this race.
      return {error:'VERSIONE_SUPERATA',status:409};
    }
    throw error;
  }
}
module.exports={readSchedule,writeSchedule,normalizeScores,normalizeLessonLog,normalizeLeadership};
