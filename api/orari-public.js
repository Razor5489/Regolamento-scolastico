'use strict';
const {readSchedule}=require('./orari-store.cjs');
const ALLOWED='https://razor5489.github.io';
module.exports=async function(req,res){
  const origin=String(req.headers.origin||'');
  res.setHeader('Vary','Origin');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(origin && origin!==ALLOWED)return res.status(403).json({error:'Origine non consentita.'});
  if(origin===ALLOWED){
    res.setHeader('Access-Control-Allow-Origin',ALLOWED);
    res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  }
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'Metodo non consentito.'});
  try{
    const data=await readSchedule();
    if(!data?.document?.schedules || !data?.document?.teachers)throw Error('Invalid data');
    return res.status(200).json(data.document);
  }catch(error){
    console.error('Orari pubblici:',String(error?.message||error).slice(0,180));
    return res.status(503).json({error:'Gli orari non sono al momento disponibili.'});
  }
};