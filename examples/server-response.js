'use strict';

const JRPCClient = require('@desuuu/jrpc-client');
const TCPTransport = require('@desuuuu/jrpc-transport-tcp');

(async () => {
  let client = new JRPCClient({
    transport: new TCPTransport({
      host: 'example.com',
      port: 1234
    })
  });

  try {
    let response = await client.call('method', [ 'params' ], {
      rejectOnError: false
    });

    console.log(response); // The server's response

    //=> { error: ..., result: ... }
  } catch (error) {
    console.error(error); // A transport error
  }

  await client.destroy();
})();
