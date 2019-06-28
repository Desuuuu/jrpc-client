'use strict';

/**
 * @external EventEmitter
 * @see {@link https://nodejs.org/api/events.html#events_class_eventemitter}
 */

/**
 * @external LazyPromise
 * @see {@link https://github.com/then/lazy-promise}
 */

/**
 * An RPC error.
 *
 * @typedef {Object} JRPCClient~RPCError
 * @property {Number} code - Error code.
 * @property {String} message - Error message.
 * @property {*} data - Extra error data. Can be `undefined`.
 */

/**
 * An RPC response.
 *
 * @typedef {Object} JRPCClient~RPCResponse
 * @property {Object} error - {@link JRPCClient~RPCError|`RPCError`} object, `null` if none.
 * @property {*} result - Result, as returned by the call.
 */

const JRPC = require('jrpc');
const check = require('check-types');
const pProps = require('p-props');
const LazyPromise = require('lazy-promise');
const EventEmitter = require('events');

let _data = new WeakMap();

/**
 * Client class exported by the module.
 *
 * It helps communicating with a JSON-RPC server. The protocol implementation is done by {@link https://github.com/vphantom/js-jrpc|`jrpc`}.
 *
 * No transport is provided by default. You are free to write your own or use a {@link https://github.com/desuuuu/jrpc-client#transports|compatible one}.
 *
 * @class JRPCClient
 * @extends EventEmitter
 *
 * @example
 * const JRPCClient = require('@desuuuu/jrpc-client');
 */
class JRPCClient extends EventEmitter {

  /**
   * Initialize a new client instance.
   *
   * The transport must:
   * <ul>
   *   <li>inherit from {@link https://nodejs.org/api/events.html#events_class_eventemitter|EventEmitter}.</li>
   *   <li>have a boolean <b>needsConnection</b> property.</li>
   *   <li>have a <b>send</b> method taking a string parameter and returning a promise.</li>
   *   <li>emit a <b>data</b> event when receiving data. Its first parameter must be the data as an object.</li>
   * </ul>
   *
   * Additionally, if `needsConnection` is true, it must:
   * <ul>
   *   <li>have a boolean <b>isConnected</b> property.</li>
   *   <li>have a <b>connect</b> method returning a promise.</li>
   *   <li>have a <b>disconnect</b> method returning a promise.</li>
   * </ul>
   *
   * @param {Object} options - Client options.
   * @param {Object} options.transport - Transport instance to use for communication.
   * @param {Boolean} [options.autoConnect=true] - Whether to connect the transport automatically when sending data.
   * @param {Boolean} [options.batchRequests=true] - Turning this off will disable batching. The batching API will still be available but will send requests individually.
   * @param {Number} [options.timeout=60000] - Time to wait for a server response before returning an error. Minimum `1000`.
   *
   * @throws {TypeError} Invalid parameter.
   *
   * @emits JRPCClient#connected
   * @emits JRPCClient#disconnected
   * @emits JRPCClient#error
   *
   * @example
   * let client = new JRPCClient({
   *   transport: transport // Your transport instance
   * });
   */
  constructor({ transport, autoConnect = true, batchRequests = true, timeout = 60000 }) {
    super();

    checkTransport(transport);

    check.assert.boolean(autoConnect, 'invalid "autoConnect" option');
    check.assert.boolean(batchRequests, 'invalid "batchRequests" option');
    check.assert.greaterOrEqual(timeout, 1000, 'invalid "timeout" option');

    let transportHandlers = {
      'data': onTransportData.bind(this),
      'connected': onTransportConnected.bind(this),
      'disconnected': onTransportDisconnected.bind(this),
      'error': onTransportError.bind(this)
    };

    for (let event in transportHandlers) {
      transport.on(event, transportHandlers[event]);
    }

    let remote = new JRPC({
      remoteTimeout: Math.floor(timeout / 1000)
    });

    _data.set(this, {
      transport,
      transportHandlers,
      remote,
      autoConnect,
      batchRequests
    });
  }

  /**
   * Whether the transport needs to be connected before sending/receiving data.
   *
   * @type {Boolean}
   * @readonly
   */
  get needsConnection() {
    let { transport } = _data.get(this);

    return transport.needsConnection;
  }

  /**
   * Whether the transport is currently connected.
   *
   * @type {Boolean}
   * @readonly
   */
  get isConnected() {
    let { transport } = _data.get(this);

    return (!transport.needsConnection || transport.isConnected);
  }

  /**
   * Connect the transport.
   *
   * @promise {Promise} Resolves once connected.
   * @reject {Error} Connection error.
   */
  async connect() {
    let { transport } = _data.get(this);

    if (transport.needsConnection && !transport.isConnected) {
      return await transport.connect();
    }
  }

  /**
   * Disconnect the transport.
   *
   * @promise {Promise} Resolves once disconnected.
   */
  async disconnect() {
    let { transport } = _data.get(this);

    if (transport.needsConnection && transport.isConnected) {
      return await transport.disconnect();
    }
  }

  /**
   * Set a handler function for a server notification. It will be invoked with the notification parameters as its first argument.
   *
   * The current handler will be replaced by the one specified.
   *
   * @param {String} name - Name of the notification.
   * @param {Function} [handler=null] - New handler for the notification. Invoked with (params). Use `null` to remove the current handler.
   *
   * @example
   * client.notification('notification', (params) => {
   *   console.log(`received notification with ${params}`);
   * });
   */
  notification(name, handler) {
    let { remote } = _data.get(this);

    if (typeof handler === 'function') {
      remote.expose(name, (params, next) => {
        handler.call(null, params);

        next(true);
      });
    } else if (remote.exposed && remote.exposed.hasOwnProperty(name)) {
      delete remote.exposed[name];
    }
  }

  /**
   * Call a remote method.
   *
   * @param {String} method - RPC method to call.
   * @param {*} params - RPC parameters.
   * @param {Object} [options={}] - Call options.
   * @param {Boolean} [options.rejectOnError=true] - Whether to reject when the server responds with an RPC error.
   *
   * @promise {Promise} Resolves after the call.
   * @resolve {*} When `rejectOnError` is `true`, the RPC result.
   * @resolve {Object https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object} When `rejectOnError` is `false`, {@link JRPCClient~RPCResponse|`RPCResponse`} object.
   * @reject {Object https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object} When `rejectOnError` is `true`, {@link JRPCClient~RPCError|`RPCError`} object.
   * @reject {Error https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error} Transport error.
   * @reject {TypeError https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypeError} Invalid parameter.
   *
   * @connection-required
   *
   * @example
   * let result = await client.call('method', [ 'params' ]);
   */
  call(method, params, { rejectOnError = true } = {}) {
    return new Promise((resolve, reject) => {
      if (!check.nonEmptyString(method)) {
        return reject(new TypeError('missing/invalid "method" parameter'));
      }

      let { transport, remote, autoConnect } = _data.get(this);

      let makeCall = () => {
        remote.call(method, (params || []), (err, result) => {
          if (rejectOnError) {
            if (err) {
              return reject(err);
            }

            return resolve(result);
          }

          resolve({
            error: (err || null),
            result: (result || null)
          });
        });

        remote.transmit((data, next) => {
          next();

          transport.send(data).catch(reject);
        });
      };

      if (!this.isConnected) {
        if (!autoConnect) {
          return reject(new Error('Transport not connected'));
        }

        return this.connect().then(makeCall).catch(reject);
      }

      makeCall();
    });
  }

  /**
   * Prepare a call for {@link JRPCClient#batch|`batch`}.
   *
   * @param {String} method - RPC method to call.
   * @param {*} params - RPC parameters.
   *
   * @promise {LazyPromise} Resolves after the call.
   * @resolve {Object https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object} {@link JRPCClient~RPCResponse|`RPCResponse`} object.
   * @reject {Error https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error} Transport error.
   * @reject {TypeError https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypeError} Invalid parameter.
   */
  prepare(method, params) {
    return new LazyPromise((resolve, reject) => {
      if (!check.nonEmptyString(method)) {
        return reject(new TypeError('missing/invalid "method" parameter'));
      }

      let { transport, remote, batchRequests } = _data.get(this);

      remote.call(method, (params || []), (err, result) => {
        resolve({
          error: (err || null),
          result: (result || null)
        });
      });

      if (!batchRequests) {
        remote.transmit((data, next) => {
          next();

          transport.send(data).catch(reject);
        });
      }
    });
  }

  /**
   * Send a batch of remote calls.
   *
   * Calls must be prepared with {@link JRPCClient#prepare|`prepare`}.
   *
   * @param {LazyPromise[]|Object} requests - List of calls to make. Can be an array or an object of prepared calls.
   *
   * @promise {Promise} Resolves after all the calls.
   * @resolve {Object[] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object} When `requests` is an array, array of {@link JRPCClient~RPCResponse|`RPCResponse`} objects in the same order.
   * @resolve {Object https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object} When `requests` is an object, object with the same keys mapped to {@link JRPCClient~RPCResponse|`RPCResponse`} objects.
   * @reject {Error https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error} Transport error.
   * @reject {TypeError https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypeError} Invalid parameter.
   *
   * @connection-required
   *
   * @example
   * let requests = [
   *   client.prepare('method1', [ 'params' ]),
   *   client.prepare('method2', [ 'params' ])
   * ];
   *
   * let responses = await client.batch(requests);
   */
  batch(requests) {
    return new Promise((resolve, reject) => {
      let array;

      if (check.array(requests)) {
        if (check.emptyArray(requests)) {
          return resolve([]);
        }

        if (!check.array.of.instanceStrict(requests, LazyPromise)) {
          return reject(new TypeError('missing/invalid "requests" parameter'));
        }

        array = true;
      } else if (check.object(requests)) {
        if (check.emptyObject(requests)) {
          return resolve({});
        }

        if (!check.object.of.instanceStrict(requests, LazyPromise)) {
          return reject(new TypeError('missing/invalid "requests" parameter'));
        }

        array = false;
      } else {
        return reject(new TypeError('missing/invalid "requests" parameter'));
      }

      let { transport, remote, autoConnect, batchRequests } = _data.get(this);

      let makeCalls = () => {
        if (array) {
          Promise.all(requests).then(resolve).catch(reject);
        } else {
          pProps(requests).then(resolve).catch(reject);
        }

        if (batchRequests) {
          setImmediate(remote.transmit.bind(remote, (data, next) => {
            next();

            transport.send(data).catch(reject);
          }));
        }
      };

      if (!this.isConnected) {
        if (!autoConnect) {
          return reject(new Error('Transport not connected'));
        }

        return this.connect().then(makeCalls).catch(reject);
      }

      makeCalls();
    });
  }

  /**
   * Destroy the client instance. Use this if you do not need this instance anymore.
   *
   * It will disconnect the transport and try to free up resources.
   *
   * @promise {Promise} Resolves once the instance has been destroyed.
   */
  async destroy() {
    this.removeAllListeners();

    let { transport, transportHandlers, remote } = _data.get(this);

    for (let event in transportHandlers) {
      transport.removeListener(event, transportHandlers[event]);
    }

    remote.shutdown();

    await this.disconnect();

    _data.delete(this);
  }
}

/**
 * Fired when the transport gets connected.
 *
 * @event JRPCClient#connected
 */

/**
 * Fired when the transport gets disconnected.
 *
 * @event JRPCClient#disconnected
 * @param {Error} error - Encountered error, `null` if none.
 */

/**
 * Fired when an error is encountered by the transport.
 *
 * @event JRPCClient#error
 * @param {Error} error - Encountered error.
 */

module.exports = JRPCClient;

/**
 * Check if the transport is valid.
 *
 * @param {Object} transport - The transport.
 *
 * @memberof JRPCClient
 * @private
 */
function checkTransport(transport) {
  check.assert.object(transport, 'missing/invalid "transport" option');
  check.assert.instanceStrict(transport, EventEmitter, 'missing/invalid "transport" option');

  check.assert.boolean(transport.needsConnection, 'missing/invalid "transport.needsConnection" property');
  check.assert.function(transport.send, 'missing/invalid "transport.send" method');

  if (transport.needsConnection) {
    check.assert.boolean(transport.isConnected, 'missing/invalid "transport.isConnected" property');

    check.assert.function(transport.connect, 'missing/invalid "transport.connect" method');
    check.assert.function(transport.disconnect, 'missing/invalid "transport.disconnect" method');
  }
}

/**
 * Cleanup a JSON-RPC response.
 *
 * @memberof JRPCClient
 * @private
 */
function cleanResponse(response) {
  if (response && response.hasOwnProperty('error') && response.hasOwnProperty('result')) {
    if (response.error) {
      delete response.result;
    } else {
      delete response.error;
    }
  }

  return response;
}

/**
 * Handle the transport `data` event.
 *
 * @memberof JRPCClient
 * @private
 */
function onTransportData(data) {
  let { remote } = _data.get(this);

  if (data) {
    if (check.array(data)) {
      for (let i = 0; i < data.length; i++) {
        data[i] = cleanResponse(data[i]);
      }
    } else if (check.object(data)) {
      data = cleanResponse(data);
    }
  }

  remote.receive(data);
}

/**
 * Handle the transport `connected` event.
 *
 * @memberof JRPCClient
 * @private
 */
function onTransportConnected() {
  this.emit('connected');
}

/**
 * Handle the transport `disconnected` event.
 *
 * @memberof JRPCClient
 * @private
 */
function onTransportDisconnected(err) {
  this.emit('disconnected', err);
}

/**
 * Handle the transport `error` event.
 *
 * @memberof JRPCClient
 * @private
 */
function onTransportError(err) {
  this.emit('error', err);
}
