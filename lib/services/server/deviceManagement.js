/*
 * Copyright 2014 Telefonica Investigación y Desarrollo, S.A.U
 *
 * This file is part of lwm2m-node-lib
 *
 * lwm2m-node-lib is free software: you can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * lwm2m-node-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with lwm2m-node-lib.
 * If not, seehttp://www.gnu.org/licenses/.
 *
 * For those usages not covered by the GNU Affero General Public License
 * please contact with::[contacto@tid.es]
 */

'use strict';

var async = require('async'),
  apply = async.apply,
  coapUtils = require('./coapUtils'),
  errors = require('../../errors'),
  registry,
  config,
  queuedRequest = require('./queuedRequests'),
  debug = require('../../debug')('deviceManagement');


/**
 * Checks if value is present
 * @param {...*} any
 * @return {Boolean}
 */
function isPresent(any) {
    return Array.prototype.slice.call(arguments)
      .reduce(function(acc, arg) { return acc && typeof arg !== 'undefined'; }, true);
}

/*
function read(deviceId, objectId, instanceId, resourceId, callback) {

  registry.get(deviceId, function(error, device){
      if(!error){

          if(device.binding.indexOf('Q') >= 0){
            var req = {
              type: 'read',
              did: deviceId,
              oid: objectId,
              iid: instanceId,
              rid: resourceId
            };
            queued_request.push(req);
            callback(new errors.RequestInQueue('2.05'));
          } else {
            readSync(deviceId, objectId, instanceId, resourceId, callback);
          }

      }
  });


}
*/




/**
 * Execute a read operation for the selected resource, identified following the LWTM2M conventions by its: deviceId,
 * objectId, objectId and resourceId.
 */
function read(deviceId, objectId, instanceId, resourceId, callback) {
    function createReadRequest(obj, callback) {
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            method: 'GET',
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+obj.address+']' : obj.address) + ':' + obj.port,
            pathname: '/' + objectId + '/' + instanceId + '/' + resourceId
        };
        callback(null, request);
    }

    function sendRequest(callback) {
        debug('Reading value from resource /%s/%s/%s in device [%d]',
          objectId, instanceId, resourceId, deviceId);

        async.waterfall([
            apply(registry.get, deviceId),
            createReadRequest,
            coapUtils.sendRequest,
            coapUtils.generateProcessResponse(objectId, instanceId, resourceId, '2.05')
        ], callback);
    }

    queuedRequest.handle(registry, 'read', deviceId, objectId, instanceId, resourceId, sendRequest, callback);

}

/**
 * Makes a modification over the selected resource, identified following the LWTM2M conventions by its: deviceId,
 * objectId, objectId and resourceId, changing its value to the value passed as a parameter. The method will
 * determine whether its an Execute or a Write operation.
 *
 * @param {String} method           COAP Method to execute.
 * @param {String} deviceId         ID of the device that will be called.
 * @param {Number} objectId       Object type ID.
 * @param {Number} instanceId         Object instance ID.
 * @param {Number} resourceId       Resource ID.
 * @param {String} value            Value to write.
 */
function writeResource(method, deviceId, objectId, instanceId, resourceId, value, callback) {
    function createUpdateRequest(obj, callback) {
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            method: method,
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+obj.address+']' : obj.address) + ':' + obj.port,
            pathname: '/' + objectId + '/' + instanceId + '/' + resourceId,
            payload: value,
            options: {
                'Content-Format': config.writeFormat
            }
        };

        callback(null, request);
    }

    function processResponse(res, callback) {
        if (res.code === '2.04') {
            // FIXME: the response doens't contain a payload during a write request => res.payload is empty
            // add the value from the request for confirmation to the upper layer
            // RDL:  Needed to add this for execute commands
           if (value)
              callback(null, value.toString('utf8'));
           else
              callback(null, null);
        } else if (res.code === '4.04') {
            callback(new errors.ObjectNotFound('/' + objectId + '/' + instanceId));
        } else {
            callback(new errors.ClientError(res.code));
        }
    }

    function sendRequest(callback) {
        debug('Writting a new value [%s] on resource /%s/%s/%s in device [%d]',
          value, objectId, instanceId, resourceId, deviceId);

        async.waterfall([
            apply(registry.get, deviceId),
            createUpdateRequest,
            coapUtils.sendRequest,
            processResponse
        ], callback);
    }

    queuedRequest.handle(registry, 'write', deviceId, objectId, instanceId, resourceId, sendRequest, callback);
}

/**
 * Makes a Write operation over the designed resource ID of the selected device.
 */
function write(deviceId, objectId, instanceId, resourceId, value, callback) {
    writeResource('PUT', deviceId, objectId, instanceId, resourceId, value, callback);
}

/**
 * Makes an Execute operation over the designed resource ID of the selected device.
 */
function execute(deviceId, objectId, instanceId, resourceId, value, callback) {
    writeResource('POST', deviceId, objectId, instanceId, resourceId, value, callback);
}

/**
 * Write the attributes given as a parameter in the remote resource identified by the Object type and id in the
 * selected device.
 *
 * @param {String} deviceId             ID of the device that holds the resource.
 * @param {String} objectId           ID of the object type of the instance.
 * @param {String} objectId             ID of the instance whose resource will be modified.
 * @param {String} resourceId           ID of the resource to modify.
 * @param {Object} parameters           Object with the parameters to write: each parameter is stored as an attribute.
 */
function writeAttributes(deviceId, objectId, instanceId, resourceId, attributes, callback) {
    function createQueryParams(innerCb) {
        var validAttributes = ['pmin', 'pmax', 'gt', 'lt', 'st', 'cancel'],
          result = [],
          errorList = [];

        for (var i in attributes) {
            if (attributes.hasOwnProperty(i)) {
                if (validAttributes.indexOf(i) >= 0) {
                    result.push(i + '=' + attributes[i]);
                } else {
                    errorList.push(i);
                }
            }
        }

        result = result.join('&');

        if (errorList.length !== 0) {
            innerCb(new errors.UnsupportedAttributes(errorList));
        } else {
            innerCb(null, result);
        }
    }

    function createWriteAttributesRequest(data, innerCb) {
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+data[0].address+']' : data[0].address) +
            ':' + data[0].port,
            method: 'PUT',
            query: data[1]
        };
        if (isPresent(objectId, instanceId, resourceId)) {
            request.pathname = '/' + objectId + '/' + instanceId + '/' + resourceId;
        } else if (isPresent(objectId, instanceId)) {
            request.pathname = '/' + objectId + '/' + instanceId;
        } else {
            request.pathname = '/' + objectId;
        }

        innerCb(null, request);
    }

    function sendRequest(callback) {
        debug('Writting new discover attributes on resource /%s/%s/%s in device [%d]',
          objectId, instanceId, resourceId, deviceId);
        debug('The new attributes are:\n%j', attributes);

        async.waterfall([
            apply(async.parallel, [
                apply(registry.get, deviceId),
                createQueryParams
            ]),
            createWriteAttributesRequest,
            coapUtils.sendRequest,
            coapUtils.generateProcessResponse(objectId, instanceId, resourceId, '2.04')
        ], callback);
    }

    queuedRequest.handle(registry, 'writeAttribute', deviceId, objectId, instanceId, resourceId, sendRequest, callback);
}

/**
 * Execute a discover operation for the selected resource, identified following the LWTM2M conventions by its:
 * deviceId, objectId, objectId and resourceId.
 */
function discover(deviceId, objectId, instanceId, resourceId, fullCallback) {
    var pathname,
      trueCallback;

    if (isPresent(instanceId, resourceId, fullCallback)) {
        debug('Executing a resource discover operation on resource /%s/%s/%s in device [%d]',
          objectId, instanceId, resourceId, deviceId);

        pathname= '/' + objectId + '/' + instanceId + '/' + resourceId;
        trueCallback = fullCallback;
    } else if (isPresent(instanceId, resourceId)) {
        debug('Executing a instance discover operation on resource /%s/%s in device [%d]',
          objectId, instanceId, deviceId);

        pathname= '/' + objectId + '/' + instanceId;
        trueCallback = resourceId;
        resourceId = null;
    } else {
        debug('Executing a type discover operation on resource /%s in device [%d]',
          objectId, deviceId);

        pathname= '/' + objectId;
        trueCallback = instanceId;
        instanceId = null;
        resourceId = null;
    }

    function createReadRequest(obj, callback) {
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            method: 'GET',
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+obj.address+']' : obj.address) + ':' + obj.port,
            pathname: pathname,
            options: {
                'Accept': 'application/link-format'
            }
        };

        callback(null, request);
    }

    function sendRequest(callback) {
        if (!objectId && !instanceId && !resourceId) {
            debug('Method called with wrong number of parameters. Couldn\'t identify callback');
        } else {
            async.waterfall([
                apply(registry.get, deviceId),
                createReadRequest,
                coapUtils.sendRequest,
                coapUtils.generateProcessResponse(objectId, instanceId, resourceId, '2.05')
            ], callback);
        }
    }

    queuedRequest.handle(registry, 'discover', deviceId, objectId, instanceId, resourceId, sendRequest, trueCallback);
}

function create(deviceId, objectId, instanceId, callback) {
    function createUpdateRequest(obj, callback) {
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            method: 'POST',
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+obj.address+']' : obj.address) + ':' + obj.port,
            pathname: '/' + objectId + '/' + instanceId
        };

        callback(null, request);
    }

    function sendRequest(callback) {
        debug('Creating a new instance of object type [%s] in the device [%d] with instance id [%s]',
          objectId, deviceId, instanceId);

        async.waterfall([
            apply(registry.get, deviceId),
            createUpdateRequest,
            coapUtils.sendRequest,
            coapUtils.generateProcessResponse(objectId, instanceId, null, '2.01')
        ], callback);
    }

    queuedRequest.handle(registry, 'create', deviceId, objectId, instanceId, null, sendRequest, callback);
}

function remove(deviceId, objectId, instanceId, callback) {
    callback(null);
}

function init(deviceRegistry, newConfig) {
    registry = deviceRegistry;
    config = newConfig;
}

exports.read = read;
exports.write = write;
exports.execute = execute;
exports.writeAttributes = writeAttributes;
exports.discover = discover;
exports.create = create;
exports.remove = remove;
exports.init = init;

