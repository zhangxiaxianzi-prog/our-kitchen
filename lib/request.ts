// 边读边限制请求大小，不把过大的输入一次性放进内存。
export async function limitedJson(request: Request, maximum: number): Promise<unknown> {
  if (!request.body || Number(request.headers.get('content-length')) > maximum) throw new Error('请求内容过长');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size=0;
  try { while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new Error('请求内容过长');}chunks.push(value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
