const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const tp=fs.readFileSync(require('node:path').join(__dirname,'../js/data-source.js'),'utf8');
const section=tp.slice(tp.indexOf('  function nextSweep('),tp.indexOf('  function rangeLabel('));
const context={Date,SWEEP_HOURS:[6,13,18],SWEEP_MINUTE:30,LIMA_OFFSET_HOURS:-5,
  limaParts(now){const d=new Date(+now-5*3600000);return {year:d.getUTCFullYear(),month:d.getUTCMonth(),day:d.getUTCDate()};}};
vm.createContext(context); vm.runInContext(section,context);
for(const [input,expected] of [['2026-11-08T10:00:00Z','2026-11-08T11:30:00.000Z'],['2026-11-08T11:30:00Z','2026-11-08T18:30:00.000Z'],['2026-11-08T19:00:00Z','2026-11-08T23:30:00.000Z'],['2026-12-31T23:31:00Z','2027-01-01T11:30:00.000Z']])assert.equal(context.nextSweep(new Date(input)).toISOString(),expected);
console.log('TP: proximos barridos verificados, incluido cambio de dia y ano');
