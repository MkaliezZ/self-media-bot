// Deterministic protocol fixture for tests only. Never imported by the app.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ModelReply { text?: string; tool?: { name: string; input: Record<string, unknown> }; status?: number; delay?: number; finishReason?: 'end_turn' | 'max_tokens' }
export async function modelServer(reply: (body: any, index: number) => ModelReply | Promise<ModelReply>) {
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    if (!req.url?.endsWith('/messages')) { res.writeHead(404).end('{}'); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); requests.push(body);
    const answer = await reply(body, requests.length - 1);
    if (answer.delay) await new Promise(resolve => setTimeout(resolve, answer.delay));
    if (answer.status) { res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'intentional test failure' } })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const event = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    event('message_start', { type: 'message_start', message: { id: `fixture-${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    if (answer.tool) {
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `tool-${requests.length}`, name: answer.tool.name, input: {} } });
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(answer.tool.input) } });
    } else {
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.text ?? '连接成功' } });
    }
    event('content_block_stop', { type: 'content_block_stop', index: 0 });
    event('message_delta', { type: 'message_delta', delta: { stop_reason: answer.tool ? 'tool_use' : answer.finishReason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    event('message_stop', { type: 'message_stop' }); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
