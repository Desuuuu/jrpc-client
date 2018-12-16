const FakeTransport = require('./fake-transport');

class ConnectedTransport extends FakeTransport {
  constructor() {
    super();

    this._connected = false;
  }

  get needsConnection() {
    return true;
  }

  get isConnected() {
    return this._connected;
  }

  connect() {
    this._connected = true;

    return Promise.resolve();
  }

  disconnect() {
    this._connected = false;

    return Promise.resolve();
  }

  send(data) {
    if (!this._connected) {
      return Promise.reject(new Error('Transport not connected'));
    }

    return super.send(...arguments);
  }
}

module.exports = ConnectedTransport;
