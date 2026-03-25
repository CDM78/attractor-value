const fs = require('fs');
const content = fs.readFileSync('C:/Users/charl/attractor-value/data/ai-analyst-pipeline/tmp_0047.txt', 'utf8');
const d = JSON.parse(content);

// Split each job into chunks of ~8000 chars
function writeChunks(text, prefix) {
  const chunkSize = 8000;
  const total = Math.ceil(text.length / chunkSize);
  for (let i = 0; i < total; i++) {
    const chunk = text.substring(i * chunkSize, (i + 1) * chunkSize);
    fs.writeFileSync(
      `C:/Users/charl/attractor-value/data/ai-analyst-pipeline/${prefix}_chunk${i + 1}of${total}.txt`,
      chunk
    );
  }
  console.log(`${prefix}: ${total} chunks, total length ${text.length}`);
}

writeChunks(d.job1, 'j1_0047');
writeChunks(d.job2, 'j2_0047');
writeChunks(d.job4, 'j4_0047');
