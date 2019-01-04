'use strict';

const JRPCClient = require('@desuuuu/jrpc-client');
const TCPTransport = require('@desuuuu/jrpc-transport-tcp');

(async () => {
  let client = new JRPCClient({
    transport: new TCPTransport({
      host: 'example.com',
      port: 1234
    })
  });

  try {
    let requests = [
      client.prepare('method1', [ 'params' ]),
      client.prepare('method2', [ 'params' ])
    ];

    let responses = await client.batch(requests);

    console.log(responses); // An array with the server's responses

    //=> [ { error: ..., result: ... }, { error: ..., result: ... } ]
  } catch (error) {
    console.error(error); // A transport error
  }

  await client.destroy();
})();
