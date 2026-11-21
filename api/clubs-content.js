'use strict';
const {cors,authorized}=require('./_shared.cjs');
const {readClubs,writeClubs,validateClubsPage}=require('./clubs-store.cjs');
module.exports=async function(req,res){
 if(!cors(req,res,'GET,POST,PUT'))return;
 if(!['GET','POST','PUT'].includes(req.method))
  return res.status(405).json({error:'Metodo non consentito.'});
 if(!process.env.BLOB_READ_WRITE_TOKEN)
  return res.status(503).json({error:'Archivio dei Club non configurato.'});
 if(req.method==='POST'){
  if(!authorized(req))return res.status(401).json({error:'Password errata.'});
  return res.status(200).json({ok:true});
 }
 if(req.method==='PUT'&&!authorized(req))
  return res.status(401).json({error:'Password errata.'});
 if(req.method==='GET'){
  try{
   const value=await readClubs();
   return res.status(200).json(value);
  }catch(error){
   console.error('Club: lettura contenuti non riuscita:',String(error?.message||error).slice(0,160));
   return res.status(503).json({error:'I contenuti dei Club non sono temporaneamente disponibili.'});
  }
 }
 let body;
 try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}
 catch{return res.status(400).json({error:'Documento non valido.'});}
 if(!body||typeof body.sha!=='string'||body.sha.length>200||
    !validateClubsPage(body.document))
   return res.status(400).json({error:'Testi della pagina non validi.'});
 try{
  const saved=await writeClubs(body.document,body.sha);
  if(saved.error)return res.status(saved.status).json({error:saved.error});
  return res.status(200).json({ok:true,sha:saved.sha});
 }catch(error){
  console.error('Club: salvataggio archivio non riuscito:',String(error?.message||error).slice(0,160));
  return res.status(503).json({error:'Salvataggio non disponibile. Le modifiche restano in bozza finché mantieni aperta la pagina.'});
 }
};
