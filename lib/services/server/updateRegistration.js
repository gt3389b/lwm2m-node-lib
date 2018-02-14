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
 * lwm2m-node-lib is distributed in the hope that it will be useful,<
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
    registry,
    debug = require('../../debug')('updateRegistration'),
    coapUtils = require('./../coapUtils'),
    apply = async.apply,
    queuedRequest = require('./queuedRequests');

/**
 *  Generates the end of request handler that will generate the final response to the COAP Client.
 */
function endUpdate(req, res) {
    return function (error, result) {
        if (error) {
            debug('Registration request ended up in error [%s] with code [%s]', error.name, error.code);

            res.code = error.code;
            res.end(error.message);
        } else {
            debug('Update registration request ended successfully');

            res.code = '2.04';
            res.end('');

            var deviceId = parseInt(req.url.match( /\/rd\/(.*)/)[1]);

            // deliver to the device the queued requests
            // TODO: improve the recognition of the device ID from the url string
            queuedRequest.deliver( deviceId );
        }
    };
}

/**
 * Updates the lifetime and address of the Device.
 *
 * @param {Object} req              Arriving COAP Request to be processed.
 * @param {Object} queryParams      Object containing all the query parameters.
 * @param {Object} obj              Old version of the Device retrieved from the registry.
 */
function updateRegister(req, queryParams, obj, callback) {
    debug('Updating device register with lifetime [%s] and address [%s].',
        queryParams.lt, req.rsinfo.address);
    obj.lifetime = queryParams.lt || obj.lifetime;
    obj.binding = queryParams.b || obj.binding;
    obj.address = req.rsinfo.address;
    obj.port = req.rsinfo.port;
    obj.lastSeen = new Date().getTime();
    callback(null, obj);
}

/**
 * Parse the pathname of the request to extract the device id and return it through the callback.
 *
 * @param {Object} req           Arriving COAP Request to be processed.
 */
function parsePath(req, callback) {
    var pathElements = req.urlObj.pathname.split('/');

    callback(null, pathElements[2]);
}

/**
 * Invoke the user handler for this operation with the updated object as its only argument.
 *
 * @param {Function} handler        User handler for the update registration.
 * @param {String} payload          String representation of the update payload.
 * @param {Object} updatedObj       The updated Device object.
 */
function applyHandler(handler, payload, updatedObj, callback) {
    handler(updatedObj, payload.toString(), callback);
}

/**
 * Handle the registration operation.
 *
 * @param {Object} req          Arriving COAP Request to be handled.
 * @param {Object} res          Outgoing COAP Response.
 * @param {Function} handler    User handler to be executed if everything goes ok.
 */
function handleUpdateRegistration(req, res, handler) {
    debug('Handling update registration request');

    async.series([
        apply(coapUtils.extractQueryParams, req),
        apply(parsePath, req)
    ], function (error, extractedData) {
        if (error) {
            endUpdate(req, res)(error);
        } else {
            async.waterfall([
                apply(registry.get, extractedData[1]),
                apply(updateRegister, req, extractedData[0]),
                apply(registry.update, extractedData[1]),
                apply(applyHandler, handler, req.payload)
            ], endUpdate(req, res));
        }
    });
}

function setRegistry(newRegistry) {
    registry = newRegistry;
}

exports.init = setRegistry;
exports.handle = handleUpdateRegistration;
