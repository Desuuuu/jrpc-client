const EventEmitter = require('events');

const JRPCClient = require('../index');
const FakeTransport = require('./fake-transport');
const ConnectedTransport = require('./connected-transport');

describe('jrpc-client', () => {
  test('throws a TypeError when transport is not valid', () => {
    expect(() => {
      new JRPCClient();
    }).toThrow(TypeError);

    expect(() => {
      new JRPCClient({
        transport: {}
      });
    }).toThrow(TypeError);

    expect(() => {
      new JRPCClient({
        transport: true
      });
    }).toThrow(TypeError);

    expect(() => {
      new JRPCClient({
        transport: {
          needsConnection: false,
          send: () => {}
        }
      });
    }).toThrow(TypeError);
  });

  test('can be constructed and destroyed (simple transport)', async () => {
    let client = new JRPCClient({
      transport: new FakeTransport()
    });

    expect(client).toBeInstanceOf(JRPCClient);

    await client.destroy();
  });

  test('can be constructed and destroyed (connected transport)', async () => {
    let client = new JRPCClient({
      transport: new ConnectedTransport()
    });

    expect(client).toBeInstanceOf(JRPCClient);

    await client.destroy();
  });

  test('can manually connect and disconnect', async () => {
    let client = new JRPCClient({
      transport: new ConnectedTransport()
    });

    expect(client.isConnected).toBe(false);

    await client.connect();

    expect(client.isConnected).toBe(true);

    await client.disconnect();

    expect(client.isConnected).toBe(false);

    await client.connect();

    expect(client.isConnected).toBe(true);

    await client.disconnect();

    expect(client.isConnected).toBe(false);

    await client.destroy();
  });

  test('can automatically connect', async () => {
    expect.assertions(7);

    let client = new JRPCClient({
      transport: new ConnectedTransport()
    });

    expect(client.isConnected).toBe(false);

    expect(await client.call('base64', [ 'params' ])).toBe('WyJwYXJhbXMiXQ==');

    expect(client.isConnected).toBe(true);

    await client.destroy();

    client = new JRPCClient({
      transport: new ConnectedTransport(),
      autoConnect: false
    });

    expect(client.isConnected).toBe(false);

    try {
      await client.call('base64', [ 'params' ]);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);

      expect(err.message).toBe('Transport not connected');
    }

    expect(client.isConnected).toBe(false);

    await client.destroy();
  });

  test('can handle a notification', async () => {
    jest.useFakeTimers();

    let transport = new FakeTransport();

    let client = new JRPCClient({
      transport
    });

    let mockHandler = jest.fn();

    client.notification('test-notification', mockHandler);

    jest.runAllTimers();

    expect(mockHandler).toHaveBeenCalledTimes(0);

    transport.triggerNotification('test-notification', [ 'hello' ]);

    jest.runAllTimers();

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenLastCalledWith([ 'hello' ]);

    await client.destroy();
  });

  test('can remove a notification handler', async () => {
    jest.useFakeTimers();

    let transport = new FakeTransport();

    let client = new JRPCClient({
      transport
    });

    let mockHandler = jest.fn();

    client.notification('test-notification', mockHandler);

    transport.triggerNotification('test-notification', [ 'hello' ]);

    jest.runAllTimers();

    client.notification('test-notification', null);

    transport.triggerNotification('test-notification', [ 'hello' ]);

    jest.runAllTimers();

    expect(mockHandler).toHaveBeenCalledTimes(1);

    await client.destroy();
  });

  test('can call a remote method and receive a result', async () => {
    expect.assertions(4);

    let client = new JRPCClient({
      transport: new FakeTransport()
    });

    expect(await client.call('base64', [ 'params' ])).toBe('WyJwYXJhbXMiXQ==');

    try {
      await client.call('rpc-error', null);
    } catch (err) {
      expect(err).toStrictEqual({
        code: 1234,
        message: 'Generic RPC error',
      });
    }

    try {
      await client.call('transport-error', null);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);

      expect(err.message).toBe('Generic transport error');
    }

    await client.destroy();
  });

  test('can call a remote method and receive a raw response', async () => {
    expect.assertions(4);

    let client = new JRPCClient({
      transport: new FakeTransport()
    });

    expect(await client.call('base64', [ 'params' ], {
      rejectOnError: false
    })).toStrictEqual({
      error: null,
      result: 'WyJwYXJhbXMiXQ=='
    });

    expect(await client.call('rpc-error', null, {
      rejectOnError: false
    })).toStrictEqual({
      error: {
        code: 1234,
        message: 'Generic RPC error',
      },
      result: null
    });

    try {
      await client.call('transport-error', null, {
        rejectOnError: false
      });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);

      expect(err.message).toBe('Generic transport error');
    }

    await client.destroy();
  });

  test('can receive a timeout', async() => {
    expect.assertions(1);

    jest.useFakeTimers();

    let client = new JRPCClient({
      transport: new FakeTransport()
    });

    setImmediate(jest.runAllTimers);

    try {
      await client.call('non-existent-method', null);
    } catch (err) {
      expect(err).toStrictEqual({
        code: -1000,
        message: 'Timed out waiting for response',
      });
    }

    await client.destroy();
  });

  test('can send a batch of calls as an array', async () => {
    expect.assertions(6);

    jest.useFakeTimers();

    let client = new JRPCClient({
      transport: new FakeTransport()
    });

    let requests = [
      client.prepare('base64', [ 'params' ]),
      client.prepare('rpc-error', null),
      client.prepare('non-existent-method', null)
    ];

    setImmediate(jest.runAllTimers);

    let responses = await client.batch(requests);

    expect(responses).toHaveLength(3);

    expect(responses[0]).toStrictEqual({
      error: null,
      result: 'WyJwYXJhbXMiXQ=='
    });

    expect(responses[1]).toStrictEqual({
      error: {
        code: 1234,
        message: 'Generic RPC error',
      },
      result: null
    });

    expect(responses[2]).toStrictEqual({
      error: {
        code: -1000,
        message: 'Timed out waiting for response',
      },
      result: null
    });

    requests = [
      client.prepare('base64', [ 'params' ]),
      client.prepare('transport-error', null)
    ];

    try {
      await client.batch(requests);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);

      expect(err.message).toBe('Generic transport error');
    }

    await client.destroy();
  });

  test('can send a batch of calls as an object', async () => {
    expect.assertions(5);

    jest.useFakeTimers();

    let client = new JRPCClient({
      transport: new FakeTransport()
    });

    let requests = {
      'call1': client.prepare('base64', [ 'params' ]),
      'call2': client.prepare('rpc-error', null),
      'call3': client.prepare('non-existent-method', null)
    };

    setImmediate(jest.runAllTimers);

    let responses = await client.batch(requests);

    expect(responses['call1']).toStrictEqual({
      error: null,
      result: 'WyJwYXJhbXMiXQ=='
    });

    expect(responses['call2']).toStrictEqual({
      error: {
        code: 1234,
        message: 'Generic RPC error',
      },
      result: null
    });

    expect(responses['call3']).toStrictEqual({
      error: {
        code: -1000,
        message: 'Timed out waiting for response',
      },
      result: null
    });

    requests = {
      'call1': client.prepare('base64', [ 'params' ]),
      'call2': client.prepare('transport-error', null)
    };

    try {
      await client.batch(requests);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);

      expect(err.message).toBe('Generic transport error');
    }

    await client.destroy();
  });
});
