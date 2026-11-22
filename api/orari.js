'use strict';
const crypto=require('node:crypto');
const {cors}=require('./_shared.cjs');
const {readSchedule,writeSchedule}=require('./orari-store.cjs');
const {computeChanges,applyChanges}=require('./orari-merge.cjs');

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
  // Existing timetable records without points remain valid during migration.
  if(doc.points!==undefined){
    if(!doc.points||typeof doc.points!=='object'||Object.keys(doc.points).length!==4)return false;
    for(const house of HOUSES){
      if(!Number.isSafeInteger(doc.points[house]) || Math.abs(doc.points[house])>1000000)return false;
    }
  }
  // Registro lezioni: ogni record è indipendente, così più professori
  // possono registrare lezioni diverse senza sovrascriversi.
  if(doc.lessons_done!==undefined){
    const log=doc.lessons_done;
    if(!log || typeof log!=='object'||Array.isArray(log) ||
       Object.keys(log).length>600)return false;
    for(const [id,entry] of Object.entries(log)){
      if(!/^[a-zA-Z0-9-]{12,64}$/.test(id) || !entry || typeof entry!=='object' ||
         Array.isArray(entry))return false;
      if(!KEYS.includes(entry.period))return false;
      if(!Array.isArray(entry.houses)||entry.houses.length<1||entry.houses.length>4||
         new Set(entry.houses).size!==entry.houses.length ||
         entry.houses.some(h=>!HOUSES.includes(h)))return false;
      if(typeof entry.subject!=='string'||!entry.subject.trim()||
         entry.subject.length>120||/^(tempo libero|da programmare)$/i.test(entry.subject.trim()))return false;
      // Reminder-style entries do not require date, time, room or professor.
      // Older entries retain their optional historical metadata.
      if(entry.professor!==undefined &&
         (typeof entry.professor!=='string'||entry.professor.length>100))return false;
      if(entry.topic!==undefined &&
         (typeof entry.topic!=='string'||entry.topic.length>130))return false;
      if(entry.notes!==undefined &&
         (typeof entry.notes!=='string'||entry.notes.length>400))return false;
      if(['date','day','slot','start','end'].some(key=>entry[key]!==undefined)){
        if(!/^20\d{2}-\d{2}-\d{2}$/.test(entry.date)||
           !Number.isFinite(Date.parse(entry.date))||
           new Date(entry.date).toISOString().slice(0,10)!==entry.date)return false;
        if(!DAYS.includes(entry.day)||!Number.isInteger(entry.slot)||
           entry.slot<0||entry.slot>3)return false;
        if(typeof entry.start!=='string'||typeof entry.end!=='string'||
           !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.start)||
           !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.end)||
           entry.start>=entry.end)return false;
      }
      if(typeof entry.recorded_at!=='string'||
         !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(entry.recorded_at))return false;
    }
  }
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
  if(!payload || !valid(payload.base) || !valid(payload.document) ||
     typeof payload.sha!=='string'||payload.sha.length>200)
    return res.status(428).json({error:'Il pannello deve essere aggiornato alla nuova versione. Scarica la bozza, quindi aggiorna la pagina.'});

  // The role is enforced here, not only by hiding controls in the browser.
  if(role==='docente' && (
    JSON.stringify(payload.base.teachers)!==JSON.stringify(payload.document.teachers) ||
    payload.base.show_teachers!==payload.document.show_teachers
  ))return res.status(403).json({error:'La password dei professori consente di modificare soltanto gli orari.'});

  if(role==='docente'){
    const before=payload.base.lessons_done||{};
    const after=payload.document.lessons_done||{};
    for(const [id,record] of Object.entries(before)){
      if(!Object.prototype.hasOwnProperty.call(after,id) ||
         JSON.stringify(after[id])!==JSON.stringify(record)){
        return res.status(403).json({error:'I docenti possono aggiungere lezioni al registro. Le correzioni e le eliminazioni spettano alla Presidenza.'});
      }
    }
  }
  
  // A user sends both the starting snapshot and their edited document.
  // Only modified fields are extracted: unchanged fields from an old tab
  // never overwrite updates made by colleagues.
  const changes=computeChanges(payload.base,payload.document,role);
  if(changes.length>680)
    return res.status(413).json({error:'Troppe modifiche in un singolo salvataggio.'});
  if(changes.length===0)
    return res.status(200).json({ok:true,sha:current.sha,document:current.document,role,merged:false,overwritten:0,noChanges:true});

  const MAX_ATTEMPTS=16;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    if(attempt>0){
      // Re-read from private storage without caching, then re-apply the exact
      // same user edits if another teacher saved during our previous write.
      await new Promise(resolve=>setTimeout(resolve,Math.min(210,15+attempt*15)));
      try{current=await readSchedule();}
      catch(error){
        console.error('Registro orari: errore lettura durante il merge',String(error?.message||error).slice(0,140));
        return res.status(502).json({error:'Il registro non è momentaneamente disponibile. La bozza è conservata nel browser.'});
      }
    }
    if(!valid(current.document))
      return res.status(502).json({error:'Il registro online contiene dati non validi.'});
    const merged=applyChanges(current.document,changes);
    if(!valid(merged.document))
      return res.status(422).json({error:'Le fasce orarie aggiornate non risultano valide. Controlla inizio e fine della stessa lezione.'});
    if(!merged.applied)
      return res.status(200).json({ok:true,sha:current.sha,document:current.document,role,
        merged:payload.sha!==current.sha,overwritten:0,noChanges:true});
    merged.document.updated_at=new Date().toISOString();
    if(Buffer.byteLength(JSON.stringify(merged.document),'utf8')>480000)
      return res.status(413).json({error:'Il registro è troppo grande.'});
    try{
      const saved=await writeSchedule(merged.document,current.sha);
      if(saved.error && saved.status===409)continue; // Another teacher won the CAS; retry the merged edits.
      if(saved.error)return res.status(saved.status).json({error:saved.error});
      return res.status(200).json({
        ok:true,sha:saved.sha,document:merged.document,role,
        merged:payload.sha!==current.sha,overwritten:merged.overwritten,
        changesApplied:merged.applied
      });
    }catch(error){
      console.error('Registro orari: errore scrittura',String(error?.message||error).slice(0,180));
      return res.status(502).json({error:'Non è stato possibile salvare. Le modifiche rimangono in bozza.'});
    }
  }
  return res.status(503).json({
    error:'Molti salvataggi sono arrivati nello stesso momento. Riprova Pubblica online: la bozza non è stata persa.'
  });
};