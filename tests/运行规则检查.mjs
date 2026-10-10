import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('.test-runtime',{recursive:true});
await build({entryPoints:['tests/业务规则检查.ts'],bundle:true,platform:'node',format:'esm',outfile:'.test-runtime/rules-test.mjs'});
await import('../.test-runtime/rules-test.mjs');
