// Smoke test: spawn the built safe-only server, list tools, and call read/prepare tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'], env: { ...process.env } });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((tool) => tool.name);
console.log('tools:', names.join(', '));
for (const forbidden of ['pay_link', 'issue_railscard', 'create_request_link']) {
  if (names.includes(forbidden)) throw new Error(`unsafe MCP tool still registered: ${forbidden}`);
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  console.log(`\n== ${name} ==\n${result.content.map((content) => content.text).join('\n')}`);
  if (result.isError) throw new Error(`MCP smoke call failed: ${name}`);
  return JSON.parse(result.content[0].text);
}

await call('openrails_capabilities');
await call('openrails_read', { type: 'networkManifest' });
await call('openrails_prepare', { operationId: 'network.get', data: { networkId: 'arc-testnet' } });
await call('openrails_validate', {
  operationId: 'network.get',
  direction: 'request',
  envelope: {},
});

await client.close();
console.log('\nsmoke ok');
