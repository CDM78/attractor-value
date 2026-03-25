const fs = require('fs');
const content = fs.readFileSync('C:/Users/charl/attractor-value/data/ai-analyst-pipeline/tmp_0047.txt', 'utf8');
const d = JSON.parse(content);

// Write job structure info
const info = {
  job1_type: typeof d.job1,
  job1_isNull: d.job1 === null,
  job1_keys: (typeof d.job1 === 'object' && d.job1 !== null) ? Object.keys(d.job1) : null,
  job1_strLen: typeof d.job1 === 'string' ? d.job1.length : null,
  job2_type: typeof d.job2,
  job2_isNull: d.job2 === null,
  job2_keys: (typeof d.job2 === 'object' && d.job2 !== null) ? Object.keys(d.job2) : null,
  job2_strLen: typeof d.job2 === 'string' ? d.job2.length : null,
  job4_type: typeof d.job4,
  job4_isNull: d.job4 === null,
  job4_keys: (typeof d.job4 === 'object' && d.job4 !== null) ? Object.keys(d.job4) : null,
  job4_strLen: typeof d.job4 === 'string' ? d.job4.length : null,
};
fs.writeFileSync('C:/Users/charl/attractor-value/data/ai-analyst-pipeline/tmp_0047_info.json', JSON.stringify(info, null, 2));
console.log('info written');
