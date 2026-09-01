const fs = require('fs');
const path = 'd:\\crypto\\crypto-strategy-lab\\docs\\Market Data Service.md';
let s = fs.readFileSync(path, 'utf8');
const lines = s.split(/\r?\n/);
let count = 0;
const newLines = lines.map(l => {
  if (l.trim() === '```') {
    count++;
    return '';
  }
  return l;
});
console.log('removed', count, 'fences');
fs.writeFileSync(path, newLines.join('\n'));