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
    registry,
    config,
    queuedRequest = require('./queuedRequests'),
    debug = require('../../debug')('informationReporting'),
    subscriptions = {},
    _ = require('underscore');

/**
 * Generates an observer ID from its parts. The ID has the following pattern:
 *
 *   <deviceId>:/<objectId>/<instanceId>/<resourceId>
 *
 * @param {Number} deviceId         ID of the device, provided by the LWM2M server.
 * @param {Number} objectId       ID of the object type.
 * @param {Number} instanceId         ID of the object instance.
 * @param {Number} resourceId       Observed resource of the object.
 * @returns {string}                The generated ID.
 */
function buildId(deviceId, objectId, instanceId, resourceId) {
    return deviceId + ':/' + objectId + '/' + instanceId + '/' + resourceId;
}

/**
 * Parse an observer ID, returning its parts encapsulated in an object.
 *
 * @param {String} idString         Observer ID.
 * @returns {{deviceId: string, objectId: string, instanceId: string, resourceId: string}}
 */
function parseId(idString) {
    var fieldList = idString.substring(idString.indexOf(':') + 2).split('/');

    return {
        deviceId: idString.substring(0, idString.indexOf(':')),
        objectId: fieldList[0],
        instanceId: fieldList[1],
        resourceId: fieldList[2]
    };
}

/**
 * Constructs an object representing the subscription for the changes in the value of a particular resource of a
 * device.
 *
 * @param {Number} deviceId             Internal ID of the device of the subscription (not the endpoint ID).
 * @param {Number} objectId           Number identifying the object type.
 * @param {Number} instanceId             Number identifying the object instance.
 * @param {Number} resourceId           Resource of the object to be subscribed to.
 * @param {Object} observeStream        Stream object for writing into.
 * @param {Function} handler            Handler to be called each time a new piece of data arrives.
 * @returns {{id: string, resource: string, deviceId: *, stream: *, dataHandler: Function, finishHandler: Function}}
 * @constructor
 */
function ResourceListener(deviceId, objectId, instanceId, resourceId, observeStream, handler) {
    return {
        id: buildId(deviceId, objectId, instanceId, resourceId),
        resource: '/' + objectId + '/' + instanceId + '/' + resourceId,
        deviceId: deviceId,
        stream: observeStream,

        dataHandler: function (chunk) {
            debug('New data on resource /%s/%s/%s in device [%d]',
                objectId, instanceId, resourceId, deviceId);

            handler(chunk.toString('utf8'), objectId, instanceId, resourceId, deviceId);
        },

        finishHandler: function(chunk) {
            debug('Finished observing value of resource /%s/%s/%s in device [%d]',
                objectId, instanceId, resourceId, deviceId);

            delete subscriptions[this.id];
        }
    };
}

/**
 * Creates the subscription object and establish the handlers for the incoming data. The first piece of data has a
 * special treatment, as it has to be returned with the callback.
 *
 * @param {Number} deviceId             Internal ID of the device of the subscription (not the endpoint ID).
 * @param {Number} objectId           Number identifying the object type.
 * @param {Number} instanceId             Number identifying the object instance.
 * @param {Number} resourceId           Resource of the object to be subscribed to.
 * @param {Function} handler            Handler to be called each time a new piece of data arrives.
 * @param {Object} observeStream        Stream object for writing into.
 */
function processStream(deviceId, objectId, instanceId, resourceId, handler, observeStream, callback) {

    /* The ObserveReadStream send a 4.04 in case of unsuccessfull observation. */
    if (observeStream.code === '2.05') {
        var subscriptionId = buildId(deviceId, objectId, instanceId, resourceId);

        observeStream.pause();

        subscriptions[subscriptionId] =
          new ResourceListener(deviceId, objectId, instanceId, resourceId, observeStream, handler);

        observeStream.on('data', function (chunk) {
            debug('Got first piece of data on resource /%s/%s/%s in device [%d]',
              objectId, instanceId, resourceId, deviceId);

            // remove this listener and add the ResourceListener configured above
            observeStream.removeAllListeners('data');
            observeStream.on('data', subscriptions[subscriptionId].dataHandler);
        });

        callback(null, observeStream.payload.toString());

        observeStream.on('finish', subscriptions[subscriptionId].finishHandler);
        observeStream.resume();

    } else if (observeStream.code === '4.04') {
        callback({
            name: "OBSERVATION FAILED",
            message: observeStream.payload.toString(),
            code: '4.04'
        });
    }
}

/**
 * Creates a subscription to a resource in a device, executing the given handler each time new data arrives to the
 * server. As part of the the subscription process, the first piece of data will be automatically resolved in the
 * same way as a Read action (returning the current resource data in the callback). Subsquent data will be processed
 * by the handler.
 *
 * @param {Number} deviceId             Internal ID of the device of the subscription (not the endpoint ID).
 * @param {Number} objectId           Number identifying the object type.
 * @param {Number} instanceId             Number identifying the object instance.
 * @param {Number} resourceId           Resource of the object to be subscribed to.
 * @param {Function} handler            Handler to be called each time a new piece of data arrives.
 */
function observe(deviceId, objectId, instanceId, resourceId, handler, callback) {
    function createObserveRequest(obj, callback) {
        var request = {
            host: obj.address,
            port: obj.port,
            method: 'GET',
            pathname: '/' + objectId + '/' + instanceId + '/' + resourceId,
            observe: true
        };

        callback(null, request);
    }

    function sendRequest(callback) {
        debug('Observing value from resource /%s/%s/%s in device [%d]',
          objectId, instanceId, resourceId, deviceId);

        async.waterfall([
            apply(registry.get, deviceId),
            createObserveRequest,
            coapUtils.sendRequest,
            apply(processStream, deviceId, objectId, instanceId, resourceId, handler)
        ], callback);
    }

    queuedRequest.handle(registry, 'observe', deviceId, objectId, instanceId, resourceId, sendRequest, callback);
}

/**
 * Gets a list of all the subscriptions to client resources actually in use.
 *
 */
function list(callback) {
    callback(null, _.values(subscriptions));
}

function listByDeviceId(id, callback) {
    var sub = _.filter(subscriptions, function(e){return e.deviceId == id});
    callback(null, _.values(sub));
}

/**
 * Remove all the observations the server is currently performing.
 *
 * TODO: completely close the streams instead of simply removing them.
 */
function clean(callback) {
    var subscriptionKeys = _.keys(subscriptions);

    for (var i in subscriptionKeys) {
        subscriptions[subscriptionKeys[i]].stream.close();
        delete subscriptions[subscriptionKeys[i]];
    }

    subscriptions = {};

    if (registry){
        registry.stopLifetimeCheck();
    }

    callback();
}

function cleanByDeviceId(deviceId, callback) {
    var subscriptionKeys = _.keys(subscriptions);

    for (var i in subscriptionKeys) {
        if(subscriptions[subscriptionKeys[i]].deviceId == deviceId){
            subscriptions[subscriptionKeys[i]].stream.close();
            delete subscriptions[subscriptionKeys[i]];
        }
    }
    callback();
}

/**
 * Cancel an observation for the specified resource in a particular device.
 *
 * @param {Number} deviceId
 * @param {Number} objectId
 * @param {Number} instanceId
 * @param {Number} resourceId
 */
function cancel(deviceId, objectId, instanceId, resourceId, callback) {
    var subscriptionId = buildId(deviceId, objectId, instanceId, resourceId);

    subscriptions[subscriptionId].stream.close();
    delete subscriptions[subscriptionId];

    callback();
}

/**
 * Initializes the Information Reporting interface, specifiying the current device registry to use.
 *
 * @param {Object} deviceRegistry       Device registry in use by the application.
 */
function init(deviceRegistry, newConfig) {
    registry = deviceRegistry;
    config = newConfig;
}

exports.buildId = buildId;
exports.parseId = parseId;
exports.observe = observe;
exports.list = list;
exports.listByDeviceId = listByDeviceId;
exports.clean = clean;
exports.cleanByDeviceId = cleanByDeviceId;
exports.cancel = cancel;
exports.init = init;
