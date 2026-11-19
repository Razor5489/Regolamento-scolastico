'use strict';

// Calcola solo le modifiche dell'utente rispetto alla sua versione iniziale.
// I valori non modificati non possono sovrascrivere il lavoro di altri docenti.
const PERIODS=['1-1','1-2','2-1','2-2'];
const HOUSES=['grifondoro','tassorosso','corvonero','serpeverde'];
const ROLES=['primary','secondary','staff'];
const copy=v=>JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const str=v=>typeof v==='string'?v:'';

function computeChanges(base,edited,role){
  const changes=[];
  for(const period of PERIODS){
    for(let rowIndex=0;rowIndex<20;rowIndex++){
      const before=base.schedules[period][rowIndex];
      const after=edited.schedules[period][rowIndex];
      // Start and end are one logical timeslot: apply the pair atomically
      // to avoid mixed invalid intervals when two teachers edit both ends.
      if(before.start!==after.start || before.end!==after.end){
        changes.push({
          kind:'time-pair',period,rowIndex,
          previous:{start:before.start,end:before.end},
          value:{start:after.start,end:after.end}
        });
      }
      for(const house of HOUSES){
        if(before.subjects[house]!==after.subjects[house]){
          changes.push({kind:'lesson',period,rowIndex,house,previous:before.subjects[house],value:after.subjects[house]});
        }
      }
    }
  }
  // Punti Casa: increments are additive; concurrent awards are preserved.
  for(const house of HOUSES){
    const previous=Number(base.points?.[house] ?? 0);
    const value=Number(edited.points?.[house] ?? 0);
    const delta=value-previous;
    if(delta!==0)changes.push({kind:'house-points',house,delta});
  }
  // Ogni lezione svolta ha un ID indipendente. Si uniscono soltanto
  // i nuovi record o le correzioni, senza copiare vecchi elenchi interi.
  const prior=base.lessons_done||{};
  const next=edited.lessons_done||{};
  for(const id of new Set([...Object.keys(prior),...Object.keys(next)])){
    const before=prior[id],after=next[id];
    if(!before && after){
      changes.push({kind:'log-add',id,value:copy(after)});
    } else if(before && !after && role==='admin'){
      changes.push({kind:'log-remove',id,previous:copy(before)});
    } else if(before && after && !same(before,after) && role==='admin'){
      changes.push({kind:'log-update',id,previous:copy(before),value:copy(after)});
    }
  }
  if(role==='admin'){
    const names=new Set([...Object.keys(base.teachers),...Object.keys(edited.teachers)]);
    for(const name of names){
      const before=base.teachers[name],after=edited.teachers[name];
      if(!after&&before){changes.push({kind:'teacher-delete',name,previous:copy(before)});continue;}
      if(after&&!before){changes.push({kind:'teacher-add',name,value:copy(after)});continue;}
      for(const field of ROLES){
        const previous=str(before[field]),value=str(after[field]);
        if(previous!==value)changes.push({kind:'teacher-role',name,field,previous,value});
      }
    }
    if(base.show_teachers!==edited.show_teachers){
      changes.push({kind:'visibility',previous:base.show_teachers,value:edited.show_teachers});
    }
  }
  return changes;
}
function applyChanges(latest,changes){
  const document=copy(latest);
  let overwritten=0;
  let applied=0;
  for(const change of changes){
    let previous;
    let target;
    switch(change.kind){
      case 'time-pair':
        target=document.schedules[change.period][change.rowIndex];
        previous={start:target.start,end:target.end};
        if(!same(previous,change.previous)&&!same(previous,change.value))overwritten++;
        if(!same(previous,change.value)){
          target.start=change.value.start;
          target.end=change.value.end;
          applied++;
        }
        break;
      case 'lesson':
        target=document.schedules[change.period][change.rowIndex].subjects;
        previous=target[change.house];
        if(previous!==change.previous&&previous!==change.value)overwritten++;
        if(previous!==change.value){target[change.house]=change.value;applied++;}
        break;
      case 'teacher-delete':
        previous=document.teachers[change.name];
        if(previous && !same(previous,change.previous))overwritten++;
        if(previous){delete document.teachers[change.name];applied++;}
        break;
      case 'teacher-add':
        previous=document.teachers[change.name];
        if(previous && !same(previous,change.value))overwritten++;
        if(!same(previous,change.value)){document.teachers[change.name]=copy(change.value);applied++;}
        break;
      case 'teacher-role':
        if(!document.teachers[change.name])document.teachers[change.name]={primary:'',secondary:'',staff:''};
        target=document.teachers[change.name];
        previous=str(target[change.field]);
        if(previous!==change.previous&&previous!==change.value)overwritten++;
        if(previous!==change.value){target[change.field]=change.value;applied++;}
        break;
      case 'house-points':
        if(!document.points)document.points=Object.fromEntries(HOUSES.map(h=>[h,0]));
        previous=Number(document.points[change.house] || 0);
        if(!Number.isSafeInteger(previous+change.delta))
          throw new Error('Punteggio Casa fuori intervallo.');
        document.points[change.house]=previous+change.delta;
        applied++;
        break;
      case 'log-add':
        if(!document.lessons_done)document.lessons_done={};
        previous=document.lessons_done[change.id];
        // Non sovrascrivere una registrazione esistente con lo stesso ID.
        if(previous && !same(previous,change.value))overwritten++;
        if(!previous){document.lessons_done[change.id]=copy(change.value);applied++;}
        break;
      case 'log-remove':
        if(!document.lessons_done)document.lessons_done={};
        previous=document.lessons_done[change.id];
        if(previous && !same(previous,change.previous))overwritten++;
        if(previous){delete document.lessons_done[change.id];applied++;}
        break;
      case 'log-update':
        if(!document.lessons_done)document.lessons_done={};
        previous=document.lessons_done[change.id];
        if(!same(previous,change.previous) && !same(previous,change.value))overwritten++;
        if(!same(previous,change.value)){document.lessons_done[change.id]=copy(change.value);applied++;}
        break;
      case 'visibility':
        previous=document.show_teachers;
        if(previous!==change.previous&&previous!==change.value)overwritten++;
        if(previous!==change.value){document.show_teachers=change.value;applied++;}
        break;
      default:
        throw new Error('Tipo di modifica non valido.');
    }
  }
  return {document,overwritten,applied};
}
module.exports={computeChanges,applyChanges};
