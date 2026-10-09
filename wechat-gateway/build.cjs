const { build } = require('esbuild');
// 只把共用的业务规则编译成Node能加载的文件，不另外复制一套规则。
build({ absWorkingDir: __dirname, entryPoints: ['domain/kitchen.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/domain.cjs' }).catch(() => process.exit(1));
