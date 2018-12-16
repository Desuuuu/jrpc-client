const EventEmitter = require('events');

class FakeTransport extends EventEmitter {
  constructor() {
    super();
  }

  get needsConnection() {
    return false;
  }

  send(data) {
    try {
      data = JSON.parse(data);

      if (typeof data === 'object') {
        if (data instanceof Array) {
          data.forEach(fakeResponse.bind(this));
        } else {
          fakeResponse.call(this, data);
        }
      }
    } catch (err) {
      return Promise.reject(err);
    }

    return Promise.resolve();
  }

  triggerNotification(name, params) {
    setImmediate(this.emit.bind(this, 'data', {
      jsonrpc: '2.0',
      method: name,
      params: params
    }));
  }
}

module.exports = FakeTransport;

function fakeResponse(request) {
  if (request.method === 'transport-error') {
    throw new Error('Generic transport error');
  }

  if (request.method === 'base64') {
    let result = Buffer.from(JSON.stringify(request.params)).toString('base64');

    setImmediate(this.emit.bind(this, 'data', {
      jsonrpc: '2.0',
      id: request.id,
      result: result
    }));
  }

  if (request.method === 'rpc-error') {
    setImmediate(this.emit.bind(this, 'data', {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: 1234,
        message: 'Generic RPC error'
      }
    }));
  }
}
