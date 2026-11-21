'use strict';
const {cors,authorized,validate}=require('./_shared.cjs');
const {readDocument,saveDocument}=require('./document-store.cjs');

module.exports=async function(req,res){
 if(!cors(req,res,'GET,PUT'))return;
 if(!['GET','PUT'].includes(req.method))
  return res.status(405).json({error:'Metodo non consentito.'});
 if(!process.env.ADMIN_PASSWORD||!process.env.BLOB_READ_WRITE_TOKEN)
  return res.status(503).json({error:'Servizio non ancora configurato.'});
 if(!authorized(req))
  return res.status(401).json({error:'Password errata.'});
 if(req.method==='GET'){
  try{
   const current=await readDocument();
   return res.status(200).json(current);
  }catch(error){
   console.error('Regolamento: lettura archivio:',String(error?.message||error).slice(0,180));
   return res.status(503).json({error:'Non riesco a leggere il regolamento online. Riprova tra poco.'});
  }
 }
 let body;
 try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}
 catch{return res.status(400).json({error:'Richiesta non valida.'});}
 if(!body||typeof body.sha!=='string'||body.sha.length>200||!validate(body.document))
  return res.status(400).json({error:'Dati del regolamento non validi.'});
 if(Buffer.byteLength(JSON.stringify(body.document),'utf8')>150000)
  return res.status(413).json({error:'Documento troppo grande.'});
 try{
  const saved=await saveDocument(body.document,body.sha);
  if(saved.error)return res.status(saved.status).json({error:saved.error});
  return res.status(200).json({ok:true,sha:saved.sha});
 }catch(error){
  console.error('Regolamento: salvataggio archivio:',String(error?.message||error).slice(0,180));
  return res.status(503).json({error:'Il salvataggio non è disponibile. La bozza rimane aperta nel browser.'});
 }
};
