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

    return new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  disconnect() {
    this._connected = false;

    return new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  send(data) {
    if (!this._connected) {
      return Promise.reject(new Error('Transport not connected'));
    }

    return super.send(...arguments);
  }
}

module.exports = ConnectedTransport;
