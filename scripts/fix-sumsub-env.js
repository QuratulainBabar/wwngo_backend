import fs from 'fs';

const path = '.env';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /^SUMSUB_APP_TOKEN=\s*"([^"]*)"\s*$/m,
  'SUMSUB_APP_TOKEN=$1'
);
content = content.replace(
  /^SUMSUB_SECRET_KEY=\s*"([^"]*)"\s*$/m,
  'SUMSUB_SECRET_KEY=$1'
);

if (!/^SUMSUB_LEVEL_NAME=/m.test(content)) {
  content = `${content.trimEnd()}\nSUMSUB_LEVEL_NAME=basic-kyc-level\n`;
}
if (!/^SUMSUB_BASE_URL=/m.test(content)) {
  content = `${content.trimEnd()}\nSUMSUB_BASE_URL=https://api.sumsub.com\n`;
}

fs.writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
console.log('env_format_fixed');
