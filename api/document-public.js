'use strict';
const {cors}=require('./_shared.cjs');
const {readDocument}=require('./document-store.cjs');

module.exports=async function(req,res){
 if(!cors(req,res,'GET'))return;
 if(req.method!=='GET')return res.status(405).json({error:'Metodo non consentito.'});
 if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Archivio scolastico non disponibile.'});
 try{
  const current=await readDocument();
  return res.status(200).json({document:current.document});
 }catch(error){
  console.error('Regolamento pubblico:',String(error?.message||error).slice(0,160));
  return res.status(503).json({error:'Il regolamento online non è temporaneamente disponibile.'});
 }
};
