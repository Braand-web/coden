import assert from 'node:assert/strict';
import { createJsonSseParser } from './src/lib/sse-parser.ts';

function collect() {
  const events: Array<{ type: string; data: any }> = [];
  const parser = createJsonSseParser((type, data) => {
    events.push({ type, data });
  });

  return { events, parser };
}

{
  const { events, parser } = collect();
  parser.push('event: answering\ndata: {"message":"Bonjour","payload":{"text":"Salut"}}');
  parser.flush();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'answering');
  assert.equal(events[0].data.payload.text, 'Salut');
}

{
  const { events, parser } = collect();
  parser.push('data: {"event_type":"plan_ready","payload":{"text":"Step 1"}}\r\n\r\n');

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'plan_ready');
}

{
  const { events, parser } = collect();
  parser.push('event: answering\r\n');
  parser.push('data: {"message":');
  parser.push('"Hello"}\r\n\r\n');

  assert.deepEqual(events.map(event => event.type), ['answering']);
  assert.equal(events[0].data.message, 'Hello');
}

{
  const { events, parser } = collect();
  parser.push('event: answering\ndata: {not-json}\n\n');

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.payload && typeof events[0].data.message, 'string');
}

console.log('sse parser tests passed');
