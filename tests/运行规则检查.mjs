import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('.sites-runtime',{recursive:true});
await build({entryPoints:['tests/业务规则检查.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/rules-test.mjs'});
await import('../.sites-runtime/rules-test.mjs');
