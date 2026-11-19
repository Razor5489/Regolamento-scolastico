'use strict';
const crypto=require('node:crypto');
const {cors}=require('./_shared.cjs');
const {readSchedule,writeSchedule}=require('./orari-store.cjs');

const DAYS=['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì'];
const KEYS=['1-1','1-2','2-1','2-2'];
const HOUSES=['grifondoro','tassorosso','corvonero','serpeverde'];

function valid(doc){
  if(!doc||typeof doc!=='object'||!doc.schedules||!doc.teachers||
     typeof doc.schedules!=='object'||typeof doc.teachers!=='object')return false;
  if(Object.keys(doc.schedules).length!==4||Object.keys(doc.schedules).some(k=>!KEYS.includes(k)))return false;
  if(Object.keys(doc.teachers).length>40)return false;
  if(doc.show_teachers!==undefined&&typeof doc.show_teachers!=='boolean')return false;
  if(doc.updated_at!==undefined&&(typeof doc.updated_at!=='string'||doc.updated_at.length>55))return false;
  for(const [subject,people] of Object.entries(doc.teachers)){
    if(typeof subject!=='string'||!subject.trim()||subject.length>120||
       !people||typeof people!=='object')return false;
    for(const role of ['primary','secondary','staff']){
      if(people[role]!==undefined&&(typeof people[role]!=='string'||people[role].length>220))return false;
    }
  }
  for(const key of KEYS){
    const rows=doc.schedules[key];
    if(!Array.isArray(rows)||rows.length!==20)return false;
    for(let i=0;i<20;i++){
      const row=rows[i];
      if(!row||row.day!==DAYS[Math.floor(i/4)]||
         typeof row.start!=='string'||typeof row.end!=='string'||
         !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(row.start)||
         !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(row.end)||
         row.start>=row.end||!row.subjects||typeof row.subjects!=='object')return false;
      for(const house of HOUSES){
        if(typeof row.subjects[house]!=='string'||row.subjects[house].length>120)return false;
      }
    }
  }
  return true;
}
function safeMatch(received,expected){
  if(!expected)return false;
  const a=crypto.createHash('sha256').update(received,'utf8').digest();
  const b=crypto.createHash('sha256').update(expected,'utf8').digest();
  return crypto.timingSafeEqual(a,b);
}
function passwordRole(req){
  const header=String(req.headers.authorization||'');
  if(!header.startsWith('Bearer '))return null;
  const encoded=header.slice(7);
  if(encoded.length>700||!/^[A-Za-z0-9+/=]+$/.test(encoded))return null;
  let received;
  try{received=Buffer.from(encoded,'base64').toString('utf8');}
  catch{return null;}
  if(safeMatch(received,process.env.ADMIN_PASSWORD))return 'admin';
  if(safeMatch(received,process.env.ORARI_DOCENTI_PASSWORD))return 'docente';
  return null;
}
module.exports=async function(req,res){
  if(!cors(req,res,'GET,POST,PUT'))return;
  if(!process.env.ADMIN_PASSWORD||!process.env.ORARI_DOCENTI_PASSWORD||
    !process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Archivio orari non configurato.'});
  if(!['GET','POST','PUT'].includes(req.method))return res.status(405).json({error:'Metodo non consentito.'});
  const role=passwordRole(req);
  if(!role)return res.status(401).json({error:'Password di gestione errata.'});
  if(req.method==='POST')return res.status(200).json({ok:true,role});
  let current;
  try{current=await readSchedule();}
  catch(error){
    console.error('Archivio orari: impossibile leggere',String(error?.message||error).slice(0,160));
    return res.status(502).json({error:'Il registro orari non è temporaneamente disponibile.'});
  }
  if(!valid(current.document))return res.status(502).json({error:'Il registro orari pubblicato non è valido.'});
  if(req.method==='GET')return res.status(200).json({document:current.document,sha:current.sha,role});
  let payload;
  try{payload=typeof req.body==='string'?JSON.parse(req.body):req.body;}
  catch{return res.status(400).json({error:'Dati non validi.'});}
  if(!payload||typeof payload.sha!=='string'||payload.sha.length>200||
     !valid(payload.document))return res.status(400).json({error:'Orari non validi.'});
  if(current.sha!==payload.sha)return res.status(409).json({error:'Gli orari sono stati modificati da un’altra persona. Esporta la bozza e ricarica i dati.'});
  if(role==='docente' && (
    JSON.stringify(payload.document.teachers)!==JSON.stringify(current.document.teachers) ||
    payload.document.show_teachers!==current.document.show_teachers
  ))return res.status(403).json({error:'La password dei professori consente di modificare solo gli orari.'});
  const updated=role==='docente'?{
    ...current.document,
    schedules:payload.document.schedules,
    updated_at:new Date().toISOString()
  }:{...payload.document,updated_at:new Date().toISOString()};
  const serialized=JSON.stringify(updated);
  if(Buffer.byteLength(serialized,'utf8')>180000)return res.status(413).json({error:'Il registro è troppo grande.'});
  try{
    const r=await writeSchedule(updated,payload.sha);
    if(r.error)return res.status(r.status).json({error:r.error});
    return res.status(200).json({ok:true,sha:r.sha,document:updated,role});
  }catch(error){
    console.error('Archivio orari: impossibile scrivere',String(error?.message||error).slice(0,180));
    return res.status(502).json({error:'Impossibile salvare gli orari nell’archivio protetto. Riprova senza perdere la bozza.'});
  }
};