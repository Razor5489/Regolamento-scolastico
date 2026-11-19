'use strict';
const crypto=require('node:crypto');
const {cors,authorized}=require('./_shared.cjs');
const GH='https://api.github.com/repos/Razor5489/ORARIO-LEZIONI-NIGHTFALL/contents/orari.json';
const DAYS=['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì'];
const KEYS=['1-1','1-2','2-1','2-2'];
const HOUSES=['grifondoro','tassorosso','corvonero','serpeverde'];

function valid(doc){
  if(!doc||typeof doc!=='object'||!doc.schedules||!doc.teachers||
     typeof doc.schedules!=='object'||typeof doc.teachers!=='object')return false;
  if(Object.keys(doc.schedules).length!==4||
     Object.keys(doc.schedules).some(k=>!KEYS.includes(k)))return false;
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
function passwordRole(req){
  if(authorized(req))return 'admin';
  const expected=process.env.ORARI_DOCENTI_PASSWORD;
  if(!expected || !process.env.GITHUB_TOKEN)return null;
  const header=String(req.headers.authorization||'');
  if(!header.startsWith('Bearer '))return null;
  const encoded=header.slice(7);
  if(encoded.length>700||!/^[A-Za-z0-9+/=]+$/.test(encoded))return null;
  let received;
  try{received=Buffer.from(encoded,'base64').toString('utf8');}
  catch{return null;}
  const a=crypto.createHash('sha256').update(received,'utf8').digest();
  const b=crypto.createHash('sha256').update(expected,'utf8').digest();
  return crypto.timingSafeEqual(a,b)?'docente':null;
}
async function github(method='GET',payload){
  try{
    const r=await fetch(GH,{
      method,cache:'no-store',
      headers:{
        'Authorization':'Bearer '+process.env.GITHUB_TOKEN,
        'Accept':'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'nightfall-orari-backend',
        ...(payload?{'Content-Type':'application/json'}:{})
      },
      body:payload?JSON.stringify(payload):undefined
    });
    const body=await r.json().catch(()=>({}));
    if(!r.ok){
      const conflict=[409,422].includes(r.status);
      console.error('Nightfall orari: GitHub request failed', {status:r.status,message:String(body.message||'').slice(0,180)});
      return {status:conflict?409:502,error:conflict?
        'Orario già modificato da un altro amministratore. Ricarica i dati.' :
        r.status===403 ? 'GitHub non autorizza la scrittura: controlla il permesso Contents: Read and write del token configurato su Vercel.' :
        r.status===404 ? 'Il file degli orari non è accessibile al servizio GitHub.' :
        'GitHub ha rifiutato il salvataggio (HTTP '+r.status+').'};
    }
    return {body};
  }catch(error){
    console.error('Nightfall orari: connessione GitHub non riuscita',String(error?.message||error).slice(0,120));
    return {status:502,error:'Impossibile contattare GitHub.'};
  }
}
function decodeRepoContent(value){
  const doc=JSON.parse(Buffer.from(String(value||'').replace(/\s/g,''),'base64').toString('utf8'));
  if(!valid(doc))throw new Error('invalid');
  return doc;
}
module.exports=async function(req,res){
  if(!cors(req,res,'GET,POST,PUT'))return;
  if(!process.env.ADMIN_PASSWORD||!process.env.GITHUB_TOKEN||!process.env.ORARI_DOCENTI_PASSWORD)
    return res.status(503).json({error:'Servizio orari non ancora configurato.'});
  if(!['GET','POST','PUT'].includes(req.method))
    return res.status(405).json({error:'Metodo non consentito.'});
  const role=passwordRole(req);
  if(!role)return res.status(401).json({error:'Password di gestione errata.'});
  if(req.method==='POST')return res.status(200).json({ok:true,role});
  if(req.method==='GET'){
    const r=await github();
    if(r.error)return res.status(r.status).json({error:r.error});
    try{
      const doc=decodeRepoContent(r.body.content);
      return res.status(200).json({document:doc,sha:r.body.sha,role});
    }catch{return res.status(502).json({error:'Il formato del registro orari non è valido.'});}
  }
  let payload;
  try{payload=typeof req.body==='string'?JSON.parse(req.body):req.body;}
  catch{return res.status(400).json({error:'Dati non validi.'});}
  if(!payload||typeof payload.sha!=='string'||!/^[a-f0-9]{40}$/.test(payload.sha)||
     !valid(payload.document))return res.status(400).json({error:'Orari non validi.'});
  const current=await github();
  if(current.error)return res.status(current.status).json({error:current.error});
  if(current.body.sha!==payload.sha)
    return res.status(409).json({error:'Gli orari sono stati modificati da un altro utente. Esporta la bozza prima di ricaricare la pagina.'});
  let existing;
  try{existing=decodeRepoContent(current.body.content);}
  catch{return res.status(502).json({error:'Impossibile leggere gli orari pubblicati.'});}
  if(role==='docente'){
    if(JSON.stringify(payload.document.teachers)!==JSON.stringify(existing.teachers)||
       payload.document.show_teachers!==existing.show_teachers)
      return res.status(403).json({error:'I docenti possono modificare gli orari, non il corpo docenti.'});
  }
  const updated = role==='docente' ? {
    ...existing,
    schedules:payload.document.schedules,
    updated_at:new Date().toISOString()
  } : {...payload.document,updated_at:new Date().toISOString()};
  const value=JSON.stringify(updated,null,2)+'\n';
  if(Buffer.byteLength(value,'utf8')>180000)
    return res.status(413).json({error:'Registro troppo grande.'});
  const r=await github('PUT',{
    message:'Aggiorna orari Nightfall dal pannello '+(role==='docente'?'docenti':'amministrazione'),
    content:Buffer.from(value,'utf8').toString('base64'),
    sha:payload.sha,
    branch:'main'
  });
  if(r.error)return res.status(r.status).json({error:r.error});
  return res.status(200).json({ok:true,sha:r.body.content.sha,document:updated,role});
};