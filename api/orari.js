'use strict';
const {cors,authorized}=require('./_shared.cjs');
const GH='https://api.github.com/repos/Razor5489/ORARIO-LEZIONI-NIGHTFALL/contents/orari.json';
const DAYS=['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì'];
const KEYS=['1-1','1-2','2-1','2-2'];
const HOUSES=['grifondoro','tassorosso','corvonero','serpeverde'];

function valid(doc){
  if(!doc||typeof doc!=='object'||!doc.schedules||!doc.teachers||
     typeof doc.schedules!=='object'||typeof doc.teachers!=='object')return false;
  if(Object.keys(doc.schedules).some(k=>!KEYS.includes(k)))return false;
  if(Object.keys(doc.teachers).length>40)return false;
  if(doc.show_teachers!==undefined&&typeof doc.show_teachers!=='boolean')return false;
  if(doc.updated_at!==undefined&&String(doc.updated_at).length>55)return false;
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
      return {status:conflict?409:502,error:conflict?
        'Orario già modificato da un altro amministratore. Ricarica i dati.' :
        'GitHub ha rifiutato la richiesta. Verifica l’accesso del servizio al repository ORARIO-LEZIONI-NIGHTFALL.'};
    }
    return {body};
  }catch{return {status:502,error:'Impossibile contattare GitHub.'};}
}
module.exports=async function(req,res){
  if(!cors(req,res,'GET,POST,PUT'))return;
  if(!process.env.ADMIN_PASSWORD||!process.env.GITHUB_TOKEN)
    return res.status(503).json({error:'Servizio non configurato.'});
  if(!['GET','POST','PUT'].includes(req.method))
    return res.status(405).json({error:'Metodo non consentito.'});
  if(!authorized(req))
    return res.status(401).json({error:'Password di gestione errata.'});
  if(req.method==='POST')return res.status(200).json({ok:true});
  if(req.method==='GET'){
    const r=await github();
    if(r.error)return res.status(r.status).json({error:r.error});
    try{
      const doc=JSON.parse(Buffer.from(String(r.body.content).replace(/\s/g,''),'base64').toString('utf8'));
      if(!valid(doc))throw Error('invalid');
      return res.status(200).json({document:doc,sha:r.body.sha});
    }catch{return res.status(502).json({error:'Il formato del registro orari non è valido.'});}
  }
  let payload;
  try{payload=typeof req.body==='string'?JSON.parse(req.body):req.body;}
  catch{return res.status(400).json({error:'Dati non validi.'});}
  if(!payload||typeof payload.sha!=='string'||!/^[a-f0-9]{40}$/.test(payload.sha)||
     !valid(payload.document))return res.status(400).json({error:'Orari non validi.'});
  const value=JSON.stringify(payload.document,null,2)+'\n';
  if(Buffer.byteLength(value,'utf8')>180000)
    return res.status(413).json({error:'Registro troppo grande.'});
  const r=await github('PUT',{
    message:'Aggiorna gli orari Nightfall dalla gestione protetta',
    content:Buffer.from(value,'utf8').toString('base64'),
    sha:payload.sha,
    branch:'main'
  });
  if(r.error)return res.status(r.status).json({error:r.error});
  return res.status(200).json({ok:true,sha:r.body.content.sha});
};